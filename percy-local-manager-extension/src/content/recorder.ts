/**
 * Content script injected into pages. Captures user actions while recording is
 * active and forwards them to the background worker, which owns the state
 * (so the popup can close freely). Self-contained: content scripts are not ES
 * modules, so Vite bundles this file into a single script.
 */
import { isDynamicText, isGeneratedId, isSensitiveField, isUnstableClass, rankTarget, toValueRef } from '../utils/recorderCore';
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

function count(sel: string): number {
  try {
    return document.querySelectorAll(sel).length;
  } catch {
    return 0;
  }
}

function attrSel(tag: string, attr: string, value: string): string {
  return `${tag}[${attr}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/** Stable classes of an element (no hashed / state / numeric classes). */
function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter((c) => !isUnstableClass(c) && /^[A-Za-z_-][\w-]*$/.test(c));
}

/** Own-attribute selectors that survive reloads: aria-label, title, alt, href path, type... */
function attributeCss(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  const out: string[] = [];
  for (const attr of ['aria-label', 'title', 'alt', 'placeholder', 'name']) {
    const v = el.getAttribute(attr);
    if (v && v.length <= 80 && !isDynamicText(v)) out.push(attrSel(tag, attr, v));
  }
  const href = el.getAttribute('href');
  if (href && !href.startsWith('javascript:') && href.length <= 120) {
    const path = href.replace(/[?#].*$/, '');
    if (path && path !== '/' && !/\d{4,}/.test(path)) out.push(attrSel(tag, 'href', href.replace(/#.*$/, '')));
  }
  const cls = stableClasses(el);
  if (cls.length) {
    out.push(`${tag}.${cls.slice(0, 2).map(cssEscape).join('.')}`);
    out.push(`.${cls.slice(0, 2).map(cssEscape).join('.')}`);
  }
  return out;
}

/** One segment for the ancestor path: stable id, else tag + stable classes. */
function segment(node: Element): string {
  const sid = stableCss(node);
  if (sid) return sid;
  const tag = node.tagName.toLowerCase();
  const cls = stableClasses(node).slice(0, 2);
  return cls.length ? `${tag}.${cls.map(cssEscape).join('.')}` : tag;
}

/**
 * Ancestor-scoped selector: the nearest stable ancestor plus a short
 * descendant path, kept only when it matches exactly one element. Far more
 * resilient than a long nth-of-type chain.
 */
function scopedCss(el: Element): string | undefined {
  const own = attributeCss(el)[0] ?? segment(el);
  let anc: Element | null = el.parentElement;
  for (let depth = 0; anc && anc !== document.body && depth < 5; depth++, anc = anc.parentElement) {
    const stable = stableCss(anc) ?? (stableClasses(anc).length ? segment(anc) : undefined);
    if (!stable) continue;
    const sel = `${stable} ${own}`;
    if (count(sel) === 1) return sel;
  }
  return undefined;
}

/**
 * Last-resort structural selector (tag + nth-of-type chain up to the nearest
 * element with a stable id).
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

function normText(el: Element): string {
  return (el.textContent ?? '').trim().replace(/\s+/g, ' ');
}

function inSecretContainer(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const id = n.getAttribute('id');
    const nm = n.getAttribute('name');
    if ((id || nm) && isSensitiveField({ id, name: nm, type: n.getAttribute('type') })) return true;
  }
  return false;
}

/**
 * Builds several independent, ranked locators for one element so replay can
 * fall back when one stops matching: test id > role+name > stable id/name >
 * stable attributes/classes (unique ones first) > ancestor-scoped path >
 * non-dynamic text > structural path (last resort).
 */
function targetFor(el: Element): Target {
  const testId =
    el.getAttribute('data-testid') ?? el.getAttribute('data-test-id') ?? el.getAttribute('data-test') ?? undefined;
  const role = roleOf(el);
  const rawName = accessibleName(el);
  const secret = inSecretContainer(el);
  // Counters, prices and one-character labels ("0", "X") are not identifiers.
  const name = rawName && !secret && !isDynamicText(rawName) ? rawName : undefined;
  const text = (el.tagName.toLowerCase() === 'a' || role === 'button') && name ? name : undefined;

  const unique: string[] = [];
  const shared: string[] = [];
  for (const sel of attributeCss(el)) (count(sel) === 1 ? unique : shared).push(sel);
  const scoped = scopedCss(el);
  const cssList = [...unique, ...(scoped ? [scoped] : [])];

  // Leaf text as a late fallback when the element has no accessible name.
  let leafText: string | undefined;
  if (!text && !secret && el.children.length === 0) {
    const t = normText(el);
    if (t && t.length <= 80 && !isDynamicText(t)) leafText = t;
  }

  const structural = structuralCss(el);
  const ranked = rankTarget(
    { testId, role, name, css: stableCss(el), text: text ?? leafText },
    [...cssList, ...shared.slice(0, 1), ...(structural ? [structural] : [])],
  );
  return ranked;
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
