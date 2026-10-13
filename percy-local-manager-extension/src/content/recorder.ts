/**
 * Content script injected into pages. Captures user actions while recording is
 * active and forwards them to the background worker, which owns the state
 * (so the popup can close freely). Self-contained: content scripts are not ES
 * modules, so Vite bundles this file into a single script.
 */
import { isGeneratedId, isSensitiveField, rankTarget, toValueRef } from '../utils/recorderCore';
import type { RecordingState, Target, WorkflowStep } from '../types/workflow';
import { initWidget, setState } from './widget';

type Draft = Omit<WorkflowStep, 'id'>;

let recording = false;

function send(step: Draft) {
  chrome.runtime.sendMessage({ kind: 'rec:event', step }).catch(() => {
    /* worker asleep or recording stopped: ignore */
  });
}

function cssEscape(v: string): string {
  return CSS.escape(v);
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const id = el.getAttribute('id');
  if (id) {
    const lbl = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const wrap = el.closest('label');
  if (wrap?.textContent) return wrap.textContent.trim();
  const ph = el.getAttribute('placeholder');
  if (ph) return ph.trim();
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
  return text.length <= 80 ? text : '';
}

function roleOf(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
    return 'textbox';
  }
  if (/^h[1-6]$/.test(tag)) return 'heading';
  return undefined;
}

/** Selector built only from stable attributes; null if nothing stable exists. */
function stableCss(el: Element): string | undefined {
  const id = el.getAttribute('id');
  if (id && !isGeneratedId(id)) return `#${cssEscape(id)}`;
  const name = el.getAttribute('name');
  if (name) return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
  return undefined;
}

/**
 * Last-resort structural selector (tag + nth-of-type chain up to the nearest
 * element with a stable id). Used so every recorded click has a locator even
 * when the element has no test id, role/name, id or name attribute.
 */
function structuralCss(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement && parts.length < 8) {
    const stable = stableCss(node);
    if (stable && node !== el) {
      parts.unshift(stable);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
    node = parent;
  }
  return parts.join(' > ');
}

function targetFor(el: Element): Target {
  const testId =
    el.getAttribute('data-testid') ?? el.getAttribute('data-test-id') ?? el.getAttribute('data-test') ?? undefined;
  const role = roleOf(el);
  const name = accessibleName(el) || undefined;
  const text = el.tagName.toLowerCase() === 'a' || role === 'button' ? name : undefined;
  const ranked = rankTarget({ testId, role, name, css: stableCss(el), text });
  const hasLocator = !!(ranked.testId || ranked.role || ranked.css || ranked.text);
  // Role alone (no accessible name) is ambiguous; prefer the structural path.
  if (hasLocator && !(ranked.role && !ranked.name && !ranked.testId && !ranked.css && !ranked.text)) return ranked;
  // Nothing stable on the element itself (e.g. a dropdown option whose id is
  // generated). Its visible text survives reloads far better than a position,
  // so use it first and keep the structural path only as a fallback.
  const css = structuralCss(el);
  // Only a leaf element's own text is a meaningful locator. A wrapper's
  // textContent concatenates every descendant ("demouserSelect PasswordLog In")
  // and would never match anything on replay.
  const visible = el.children.length === 0 ? (el.textContent ?? '').trim().replace(/\s+/g, ' ') : '';
  // Never store the visible text of something inside a secret field (for
  // example the options of a #password dropdown): it may be the secret itself.
  const inSecretContainer = (() => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const id = n.getAttribute('id');
      const nm = n.getAttribute('name');
      if ((id || nm) && isSensitiveField({ id, name: nm, type: n.getAttribute('type') })) return true;
    }
    return false;
  })();
  if (visible && visible.length <= 80 && !inSecretContainer) {
    // Replay refuses ambiguous matches, so only lead with text when it is
    // unique on the page right now; otherwise lead with the structural path.
    const sameText = Array.from(document.querySelectorAll('body *')).filter(
      (n) => n.children.length === 0 && (n.textContent ?? '').trim().replace(/\s+/g, ' ') === visible,
    ).length;
    if (sameText <= 1) return { text: visible, ...(css ? { fallbacks: [{ css }] } : {}) };
    if (css) return { css, fallbacks: [{ text: visible }] };
  }
  return css ? { css, ...(ranked.fallbacks ? { fallbacks: ranked.fallbacks } : {}) } : ranked;
}

function interactive(el: EventTarget | null): Element | null {
  if (!(el instanceof Element)) return null;
  return el.closest('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], summary, label') ?? el;
}

/** True for events that originate inside the floating recorder panel. */
function fromWidget(e: Event): boolean {
  return e.composedPath().some((n) => n instanceof Element && n.hasAttribute('data-percy-recorder'));
}

function onClick(e: MouseEvent) {
  if (!recording || !e.isTrusted || fromWidget(e)) return;
  const el = interactive(e.target);
  if (!el) return;
  const tag = el.tagName.toLowerCase();
  // Inputs/selects are recorded via change/input events, not clicks.
  if (tag === 'select' || tag === 'textarea') return;
  if (tag === 'input') {
    const t = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (t === 'checkbox' || t === 'radio') return; // recorded on change
    if (!['button', 'submit', 'reset'].includes(t)) return; // text fields: fill
  }
  send({ type: 'click', target: targetFor(el) });
}

function onChange(e: Event) {
  if (!recording || !e.isTrusted || fromWidget(e)) return;
  const el = e.target;
  if (el instanceof HTMLSelectElement) {
    send({ type: 'select', target: targetFor(el), value: el.value });
  } else if (el instanceof HTMLInputElement) {
    const t = el.type.toLowerCase();
    if (t === 'checkbox' || t === 'radio') {
      send({ type: el.checked ? 'check' : 'uncheck', target: targetFor(el) });
    }
  }
}

function onTextInput(e: Event) {
  if (!recording || !e.isTrusted || fromWidget(e)) return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'file'].includes(el.type)) return;
  const label = accessibleName(el);
  const sensitive = isSensitiveField({
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    id: el.getAttribute('id'),
    autocomplete: el.getAttribute('autocomplete'),
    label,
  });
  const target = targetFor(el);
  if (sensitive) {
    // Never persist the typed value: store a reference resolved at replay time.
    send({ type: 'fill', target, valueRef: toValueRef(label || el.getAttribute('name') || el.id || 'secret') });
  } else {
    send({ type: 'fill', target, value: el.value });
  }
}

let scrollTimer: number | undefined;
function onScroll() {
  if (!recording) return;
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    send({ type: 'scroll', scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) });
  }, 250);
}

// The background can inject this script into pages that were open before the
// extension loaded; never attach listeners twice on the same page.
const GUARD = '__percyRecorderInstalled';
const alreadyInstalled = (window as unknown as Record<string, boolean>)[GUARD] === true;
(window as unknown as Record<string, boolean>)[GUARD] = true;

function attach() {
  if (alreadyInstalled) return;
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('input', onTextInput, true);
  window.addEventListener('scroll', onScroll, { passive: true });
}

attach();

// The worker tells us when recording starts/stops (including after navigation).
if (!alreadyInstalled)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === 'rec:active') recording = !!msg.active;
  if (msg?.kind === 'rec:state') {
    recording = !!msg.state?.active && !msg.state?.paused;
    setState(msg.state as RecordingState);
  }
  if (msg?.kind === 'rec:viewport') {
    sendResponse({ width: window.innerWidth, height: window.innerHeight });
  }
});

// On load, ask whether this tab is being recorded (survives full navigations).
chrome.runtime
  .sendMessage({ kind: 'rec:hello', url: location.href })
  .then((res) => {
    recording = !!res?.active;
    if (res?.state) setState(res.state as RecordingState);
  })
  .catch(() => {});

void initWidget();
