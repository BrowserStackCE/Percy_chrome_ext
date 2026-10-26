/**
 * Floating, draggable recorder panel shown on the page being recorded.
 * Rendered in a closed-off Shadow DOM so page styles cannot affect it and it
 * cannot affect the page. All state lives in the background worker; this file
 * is only a view plus message senders. Plain DOM (no React) to keep the content
 * script a single small bundle.
 */
import type { RecordingState, SnapshotStepOptions, Target, WorkflowStep } from '../types/workflow';

const POS_KEY = 'recorderWidgetPos';

const CSS = `
:host { all: initial; }
.box {
  position: fixed; top: 16px; right: 16px; width: 320px; max-height: 80vh;
  display: flex; flex-direction: column;
  background: #fff; color: #1f2430; border: 1px solid #d5d9e2; border-radius: 10px;
  box-shadow: 0 10px 30px rgba(20,24,40,.25); font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif;
  z-index: 2147483647;
}
.head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; cursor: move; user-select: none;
  background: #5b3ea6; color: #fff; border-radius: 9px 9px 0 0; font-weight: 600;
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: #ff4d4f; display: inline-block; margin-right: 6px; }
.dot.off { background: #bbb; }
.body { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.body.min, .foot.min { display: none; }
.row { display: flex; gap: 6px; }
input { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #c4c9d4; border-radius: 6px; font: inherit; }
button { padding: 6px 10px; border-radius: 6px; border: 1px solid #5b3ea6; background: #fff; color: #5b3ea6; font: inherit; cursor: pointer; }
button.primary { background: #5b3ea6; color: #fff; }
button.danger { border-color: #c0392b; color: #c0392b; }
button.icon { border: none; background: transparent; color: #fff; padding: 2px 6px; font-size: 14px; }
button:disabled { opacity: .5; cursor: default; }
ol { margin: 0; padding: 0 0 0 18px; max-height: 180px; overflow: auto; }
li { margin: 2px 0; word-break: break-word; }
li.cp { color: #5b3ea6; font-weight: 600; }
li .x { border: none; background: none; color: #c0392b; padding: 0 4px; cursor: pointer; }
.msg { padding: 6px 8px; border-radius: 6px; }
.msg.err { background: #fdecea; color: #a12a1f; }
.msg.ok { background: #e8f6ec; color: #1d6b34; }
.hint { color: #667; font-size: 12px; }
label.lbl { font-size: 12px; color: #726c87; font-weight: 500; display: block; margin-bottom: 2px; }
.eyebrow { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #726c87; }
.stack { display: flex; flex-direction: column; gap: 6px; }
button.toggle { border: none; background: transparent; color: #6c47ff; font-weight: 600; font-size: 12px; padding: 5px 0; text-align: left; display: flex; gap: 7px; }
button.toggle:hover { color: #5632e0; }
button.link { border: none; background: transparent; color: #6c47ff; font-weight: 600; padding: 4px 0; text-align: left; }
button.rm { width: 28px; height: 28px; flex: none; padding: 0; border: 1px solid #e3dff0; border-radius: 7px; background: #fff; color: #726c87; font-size: 17px; line-height: 1; }
button.rm:hover:not(:disabled) { color: #d6403a; background: #fdeceb; border-color: #f3aca7; }
button.cap { background: #6c47ff; border-color: #6c47ff; color: #fff; font-weight: 600; padding: 10px 14px; }
button.cap:hover:not(:disabled) { background: #5632e0; }
.adv { background: #f1eef8; border-color: #e3dff0; border-radius: 7px; padding: 12px; gap: 12px; }
textarea { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #c4c9d4; border-radius: 6px; font: inherit; resize: vertical; }
.adv { display: flex; flex-direction: column; gap: 6px; border: 1px solid #e3e6ee; border-radius: 6px; padding: 8px; }
.chk { display: flex; align-items: center; gap: 6px; }
.chk input { flex: none; }
li .ed { border: none; background: none; color: #5b3ea6; padding: 0 4px; cursor: pointer; }
li .mv { border: none; background: none; color: #667; padding: 0 2px; cursor: pointer; }
.editor { display: flex; flex-direction: column; gap: 10px; }
button.ic { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 1; font-weight: 600; }
button.ic svg { width: 14px; height: 14px; flex: none; fill: currentColor; }
button.ic.stop { border-color: #c0392b; color: #c0392b; }
.overlay { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(21,18,31,.42); font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: #1f2430; }
.modal { width: min(540px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; gap: 14px; padding: 22px; background: #fff; border: 1px solid #e6e2ef; border-radius: 14px; box-shadow: 0 24px 60px rgba(21,18,31,.2), 0 4px 14px rgba(21,18,31,.08); overflow-y: auto; }
.modal.sm { width: min(400px, 100%); }
.modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.modal-head .eyebrow { color: #6c47ff; font-weight: 700; font-size: 10px; letter-spacing: .08em; }
.modal h2 { margin: 2px 0 0; font-size: 18px; font-weight: 700; color: #15121f; }
.modal p { margin: 0; color: #726c87; font-size: 12.5px; }
.modal-close { width: 30px; height: 30px; flex: none; padding: 0; border: 1px solid #e6e2ef; border-radius: 50%; background: #fff; color: #726c87; font-size: 20px; line-height: 1; }
.modal-close:hover { background: #f1eef8; color: #15121f; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 14px; border-top: 1px solid #e6e2ef; }
.modal-actions button { min-width: 100px; padding: 8px 14px; }
button.danger-solid { background: #d6403a; border-color: #d6403a; color: #fff; }
.modal input[type=text], .modal input[type=number], .modal textarea { padding: 9px 12px; border-color: #e6e2ef; background: #f5f4fa; }
.modal input:focus, .modal textarea:focus { outline: none; border-color: #8567ff; background: #fff; box-shadow: 0 0 0 3px #eee8ff; }
`;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let state: RecordingState = { active: false, steps: [] };
let minimized = false;
let message: { kind: 'err' | 'ok'; text: string } | null = null;
let busy = false;
let draftCheckpoint = '';
let draftName = '';
let pos: { top: number; left: number } | null = null;

// Capture-form draft (advanced options + intentional wait before capture).
interface SnapDraft {
  waitSeconds: string;
  widths: string[];
  minHeight: string;
  scope: string;
  enableJavaScript: boolean;
  percyCSS: string;
}
const freshDraft = (): SnapDraft => ({
  waitSeconds: '4',
  // Same defaults as the popup's Capture panel.
  widths: ['375', '1280'],
  minHeight: '',
  scope: '',
  enableJavaScript: false,
  percyCSS: '',
});
let snapDraft: SnapDraft = freshDraft();
let showAdvanced = false;
let editingId: string | null = null;
let editDraft: SnapDraft | null = null;
let editDraftFor: string | null = null;
let editError: string | null = null;
let confirmDeleteId: string | null = null;

const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11a.7.7 0 0 0 1.07.6l8.6-5.5a.7.7 0 0 0 0-1.2L5.07 1.9A.7.7 0 0 0 4 2.5z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>';

/** Button with a static inline SVG icon and a visible text label. */
function iconButton(svg: string, text: string, cls: string, disabled: boolean): HTMLButtonElement {
  const b = el('button', { class: `ic ${cls}`.trim(), disabled });
  const holder = document.createElement('span');
  holder.style.display = 'inline-flex';
  holder.innerHTML = svg;
  b.append(holder, document.createTextNode(text));
  return b;
}

/** Validates a draft the same way the Go backend does; returns values or an error. */
function parseSnapDraft(
  d: SnapDraft,
): { error: string } | { waitMs: number; options?: SnapshotStepOptions } {
  const sec = Number(d.waitSeconds);
  if (d.waitSeconds.trim() === '' || !Number.isFinite(sec) || sec < 0 || sec > 60) {
    return { error: 'Wait must be between 0 and 60 seconds.' };
  }
  const widths: number[] = [];
  for (const part of d.widths.map((p) => p.trim()).filter(Boolean)) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > 4000) return { error: 'Widths must be whole numbers 1-4000, comma separated.' };
    widths.push(n);
  }
  if (widths.length > 10) return { error: 'At most 10 widths.' };
  let minHeight: number | undefined;
  if (d.minHeight.trim() !== '') {
    minHeight = Number(d.minHeight);
    if (!Number.isInteger(minHeight) || minHeight < 0 || minHeight > 20000) return { error: 'Minimum height must be 0-20000.' };
  }
  if (d.scope.length > 500) return { error: 'Scope is too long.' };
  if (d.percyCSS.length > 10000) return { error: 'Percy CSS is too long.' };
  const options: SnapshotStepOptions = {};
  if (widths.length) options.widths = widths;
  if (minHeight) options.minHeight = minHeight;
  if (d.scope.trim()) options.scope = d.scope.trim();
  if (d.enableJavaScript) options.enableJavaScript = true;
  if (d.percyCSS.trim()) options.percyCSS = d.percyCSS.trim();
  return { waitMs: Math.round(sec * 1000), options: Object.keys(options).length ? options : undefined };
}

function draftFromStep(s: WorkflowStep): SnapDraft {
  return {
    waitSeconds: String((s.waitMs ?? 4000) / 1000),
    widths: (s.options?.widths ?? []).map(String),
    minHeight: s.options?.minHeight ? String(s.options.minHeight) : '',
    scope: s.options?.scope ?? '',
    enableJavaScript: s.options?.enableJavaScript ?? false,
    percyCSS: s.options?.percyCSS ?? '',
  };
}

function describeTarget(t?: Target): string {
  if (!t) return '';
  if (t.testId) return `[data-testid=${t.testId}]`;
  if (t.role && t.name) return `${t.role} "${t.name}"`;
  if (t.css) return t.css;
  if (t.text) return `text "${t.text}"`;
  return '';
}

function describeStep(s: WorkflowStep): string {
  if (s.label) return s.label;
  const w = describeTarget(s.target);
  switch (s.type) {
    case 'click': return `Click ${w}`;
    case 'fill': return s.valueRef ? `Fill ${w} with {${s.valueRef}}` : `Fill ${w}`;
    case 'select': return `Select "${s.value ?? ''}" in ${w}`;
    case 'check': return `Check ${w}`;
    case 'uncheck': return `Uncheck ${w}`;
    case 'navigate': return `Go to ${s.url ?? ''}`;
    case 'waitFor': return `Wait for ${w}`;
    case 'scroll': return `Scroll to (${s.scrollX ?? 0}, ${s.scrollY ?? 0})`;
    case 'snapshot': return `Snapshot: ${s.name ?? s.checkpointId ?? ''}${s.waitMs !== undefined ? ` (wait ${s.waitMs / 1000}s)` : ''}`;
    default: return s.type;
  }
}

async function ask<T = unknown>(msg: Record<string, unknown>): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as T & { error?: string };
  if (res && typeof res === 'object' && 'error' in res && res.error) throw new Error(res.error);
  return res;
}

async function act(fn: () => Promise<void>) {
  busy = true;
  message = null;
  render();
  try {
    await fn();
  } catch (e) {
    message = { kind: 'err', text: e instanceof Error ? e.message : String(e) };
  } finally {
    busy = false;
    render();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props as Record<string, unknown>;
  if (cls) node.className = String(cls);
  Object.assign(node, rest);
  for (const k of kids) node.append(k);
  return node;
}

function ensureHost() {
  if (host) return;
  host = document.createElement('div');
  host.setAttribute('data-percy-recorder', '');
  root = host.attachShadow({ mode: 'open' });
  document.documentElement.append(host);
}

function removeHost() {
  host?.remove();
  host = null;
  root = null;
}

function applyPos(box: HTMLElement) {
  if (!pos) return;
  box.style.top = `${pos.top}px`;
  box.style.left = `${pos.left}px`;
  box.style.right = 'auto';
}

function makeDraggable(handle: HTMLElement, box: HTMLElement) {
  handle.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).closest('button')) return;
    const rect = box.getBoundingClientRect();
    const dx = ev.clientX - rect.left;
    const dy = ev.clientY - rect.top;
    handle.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => {
      const left = Math.min(Math.max(0, e.clientX - dx), window.innerWidth - 80);
      const top = Math.min(Math.max(0, e.clientY - dy), window.innerHeight - 40);
      pos = { top, left };
      applyPos(box);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      if (pos) void chrome.storage.local.set({ [POS_KEY]: pos });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

let fieldSeq = 0;
/** Label + control, linked by id so the control has an accessible name. */
function field(label: string, input: HTMLElement): HTMLElement {
  const id = `pr-f-${++fieldSeq}`;
  input.id = id;
  return el(
    'div',
    {},
    el('label', { class: 'lbl', textContent: label, htmlFor: id }),
    el('div', { class: 'row' }, input),
  );
}

/**
 * Advanced snapshot options, mirroring the popup's Capture panel: widths list,
 * minimum height, scope, Enable JavaScript and Percy CSS. Edits mutate `d`
 * directly; structural changes (add/remove width) call `rerender`.
 */
function snapshotOptionsForm(d: SnapDraft, rerender: () => void): HTMLElement {
  const wrap = el('div', { class: 'adv stack' });

  const widthsBox = el('div', { class: 'stack' });
  widthsBox.append(el('label', { class: 'lbl', textContent: 'Widths' }));
  d.widths.forEach((w, i) => {
    const input = el('input', { type: 'number', min: '1', value: w });
    input.setAttribute('aria-label', `Width ${i + 1}`);
    input.addEventListener('input', () => { d.widths[i] = input.value; });
    const rm = el('button', { class: 'rm', textContent: '×', title: 'Remove width', disabled: d.widths.length <= 1 });
    rm.setAttribute('aria-label', `Remove width ${i + 1}`);
    rm.addEventListener('click', () => { d.widths.splice(i, 1); rerender(); });
    widthsBox.append(el('div', { class: 'row' }, input, rm));
  });
  const add = el('button', { class: 'link', textContent: '+ Add width' });
  add.addEventListener('click', () => { d.widths.push('1280'); rerender(); });
  widthsBox.append(add);

  const minH = el('input', { type: 'number', min: '0', value: d.minHeight });
  minH.addEventListener('input', () => { d.minHeight = minH.value; });
  const scope = el('input', { type: 'text', placeholder: '.main-content', value: d.scope });
  scope.addEventListener('input', () => { d.scope = scope.value; });
  const js = el('input', { type: 'checkbox', checked: d.enableJavaScript });
  js.addEventListener('change', () => { d.enableJavaScript = js.checked; });
  const css = el('textarea', { rows: 4, placeholder: '.modal { display: none; }', value: d.percyCSS });
  css.addEventListener('input', () => { d.percyCSS = css.value; });

  wrap.append(
    widthsBox,
    field('Minimum height', minH),
    field('Scope', scope),
    el('label', { class: 'chk' }, js, 'Enable JavaScript'),
    field('Percy CSS', css),
  );
  return wrap;
}

/** Editor body for one recorded step; shown inside a modal while recording or after stop. */
function stepEditor(s: WorkflowStep): HTMLElement {
  const box = el('div', { class: 'editor' });
  const label = el('input', { type: 'text', value: s.label ?? '' });
  box.append(field('Label', label));

  let nameIn: HTMLInputElement | null = null;
  // Keep the draft across re-renders so typed values survive add/remove width.
  const d = editDraft && editDraftFor === s.id ? editDraft : draftFromStep(s);
  editDraft = d;
  editDraftFor = s.id;
  if (s.type === 'snapshot') {
    nameIn = el('input', { type: 'text', value: s.name ?? '' });
    box.append(field('Snapshot name', nameIn));
    const waitIn = el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: d.waitSeconds });
    waitIn.addEventListener('input', () => { d.waitSeconds = waitIn.value; });
    box.append(field('Wait before capture (seconds)', waitIn));
    box.append(snapshotOptionsForm(d, render));
  }

  const t = s.target;
  const tIn: Partial<Record<'testId' | 'role' | 'name' | 'css', HTMLInputElement>> = {};
  if (t) {
    (['testId', 'role', 'name', 'css'] as const).forEach((k) => {
      const i = el('input', { type: 'text', value: t[k] ?? '' });
      tIn[k] = i;
      box.append(field(k === 'testId' ? 'Test ID' : k === 'name' ? 'Accessible name' : k === 'css' ? 'CSS selector' : 'Role', i));
    });
  }
  // A recorded secret stays a reference: only its name is editable, never a literal.
  let valIn: HTMLInputElement | null = null;
  if (s.type === 'fill' || s.type === 'select') {
    valIn = el('input', { type: 'text', value: s.valueRef ?? s.value ?? '' });
    box.append(field(s.valueRef ? 'Secret reference' : 'Value', valIn));
  }

  if (editError) box.append(el('div', { class: 'msg err', textContent: editError }));

  const save = el('button', { class: 'primary', textContent: 'Save step' });
  save.addEventListener('click', () => {
    const updated: WorkflowStep = { ...s, label: label.value.trim() || undefined };
    if (s.type === 'snapshot' && nameIn) {
      if (!nameIn.value.trim()) { editError = 'Snapshot name is required.'; render(); return; }
      const parsed = parseSnapDraft(d);
      if ('error' in parsed) { editError = parsed.error; render(); return; }
      updated.name = nameIn.value.trim();
      updated.waitMs = parsed.waitMs;
      updated.options = parsed.options;
    }
    if (t) {
      updated.target = {
        ...t,
        testId: tIn.testId?.value || undefined,
        role: tIn.role?.value || undefined,
        name: tIn.name?.value || undefined,
        css: tIn.css?.value || undefined,
      };
    }
    if (valIn) {
      if (s.valueRef) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(valIn.value)) { editError = 'Reference must be letters, digits, underscores.'; render(); return; }
        updated.valueRef = valIn.value;
      } else {
        updated.value = valIn.value;
      }
    }
    editError = null;
    editingId = null;
    editDraft = null;
    void act(async () => {
      await ask({ kind: 'rec:setSteps', steps: state.steps.map((o) => (o.id === s.id ? updated : o)) });
    });
  });
  const cancel = el('button', { textContent: 'Cancel' });
  cancel.addEventListener('click', closeEdit);
  box.append(el('div', { class: 'modal-actions' }, cancel, save));
  return box;
}

function closeEdit() {
  editingId = null;
  editError = null;
  editDraft = null;
  editDraftFor = null;
  render();
}

/** Backdrop + dialog shell shared by the edit and delete-confirm modals. */
function modalShell(titleId: string, eyebrow: string, title: string, sub: string, small: boolean, onClose: () => void, content: HTMLElement): HTMLElement {
  const close = el('button', { class: 'modal-close', textContent: '×', title: 'Close' });
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', onClose);
  const h2 = el('h2', { textContent: title });
  h2.id = titleId;
  const modal = el(
    'div',
    { class: small ? 'modal sm' : 'modal' },
    el('div', { class: 'modal-head' }, el('div', {}, el('span', { class: 'eyebrow', textContent: eyebrow }), h2, el('p', { textContent: sub })), close),
    content,
  );
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  const overlay = el('div', { class: 'overlay' }, modal);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) onClose(); });
  return overlay;
}

function editModal(): HTMLElement | null {
  const s = state.steps.find((o) => o.id === editingId);
  if (!s) return null;
  const sub = s.type === 'snapshot' ? 'Name, wait and Percy options for this snapshot.' : 'Update this step. Changes apply on the next replay.';
  return modalShell('pr-edit-title', 'Edit step', s.label || describeStep(s), sub, false, closeEdit, stepEditor(s));
}

function deleteModal(): HTMLElement | null {
  const s = state.steps.find((o) => o.id === confirmDeleteId);
  if (!s) return null;
  const close = () => { confirmDeleteId = null; render(); };
  const cancel = el('button', { textContent: 'Cancel' });
  cancel.addEventListener('click', close);
  const del = el('button', { class: 'danger-solid', textContent: 'Delete step', disabled: busy });
  del.addEventListener('click', () => {
    confirmDeleteId = null;
    void act(async () => { await ask({ kind: 'rec:setSteps', steps: state.steps.filter((o) => o.id !== s.id) }); });
  });
  const body = el('div', { class: 'stack' }, el('p', { textContent: `“${s.label || describeStep(s)}” will be removed from this workflow.` }), el('div', { class: 'modal-actions' }, cancel, del));
  return modalShell('pr-del-title', 'Delete step', 'Are you sure?', 'This cannot be undone.', true, close, body);
}

function stepList(): HTMLElement {
  if (state.steps.length === 0) return el('p', { class: 'hint', textContent: 'No steps yet. Use the page normally.' });
  const list = el('ol');
  state.steps.forEach((s, idx) => {
    const li = el('li', { class: s.type === 'snapshot' ? 'cp' : '' }, s.label || describeStep(s));
    const btn = (text: string, title: string, cls: string, fn: () => void, disabled = false) => {
      const b = el('button', { class: cls, textContent: text, title, disabled: disabled || busy });
      b.addEventListener('click', fn);
      return b;
    };
    const setSteps = (steps: WorkflowStep[]) => void act(async () => { await ask({ kind: 'rec:setSteps', steps }); });
    const swap = (to: number) => {
      const next = [...state.steps];
      [next[idx], next[to]] = [next[to], next[idx]];
      setSteps(next);
    };
    li.append(
      btn('↑', 'Move up', 'mv', () => swap(idx - 1), idx === 0),
      btn('↓', 'Move down', 'mv', () => swap(idx + 1), idx === state.steps.length - 1),
      btn('Edit', 'Edit step', 'ed', () => { editingId = s.id; editError = null; render(); }),
      btn('✕', 'Delete step', 'x', () => { confirmDeleteId = s.id; render(); }),
    );
    list.append(li);
  });
  queueMicrotask(() => { if (!editingId && !confirmDeleteId) list.scrollTop = list.scrollHeight; });
  return list;
}

export function render() {
  const visible = state.active || state.steps.length > 0;
  if (!visible) {
    removeHost();
    return;
  }
  ensureHost();
  if (!root) return;

  const hasSnapshot = state.steps.some((s) => s.type === 'snapshot');
  const box = el('div', { class: 'box' });
  applyPos(box);

  const minBtn = el('button', { class: 'icon', textContent: minimized ? '▢' : '–', title: minimized ? 'Expand' : 'Minimize' });
  minBtn.addEventListener('click', () => { minimized = !minimized; render(); });
  const head = el(
    'div',
    { class: 'head' },
    el(
      'span',
      {},
      el('span', { class: state.active && !state.paused ? 'dot' : 'dot off' }),
      state.active
        ? `${state.paused ? 'Paused' : 'Recording'} · ${state.steps.length} steps`
        : `Recorded · ${state.steps.length} steps`,
    ),
    minBtn,
  );
  makeDraggable(head, box);

  const body = el('div', { class: minimized ? 'body min' : 'body' });

  if (state.active) {
    // Same shape as the popup's Capture panel, except the snapshot is stored as
    // a workflow step (executed on replay) instead of being queued.
    const cp = el('input', { type: 'text', placeholder: 'Defaults to "Checkpoint N"', value: draftCheckpoint });
    cp.addEventListener('input', () => { draftCheckpoint = cp.value; });
    const snap = el('button', { class: 'cap', textContent: 'Capture Snapshot', disabled: busy });
    snap.addEventListener('click', () => {
      const parsed = parseSnapDraft(snapDraft);
      if ('error' in parsed) {
        message = { kind: 'err', text: parsed.error };
        render();
        return;
      }
      void act(async () => {
        const n = state.steps.filter((s) => s.type === 'snapshot').length + 1;
        await ask({
          kind: 'rec:snapshot',
          name: draftCheckpoint.trim() || `Checkpoint ${n}`,
          waitMs: parsed.waitMs,
          options: parsed.options,
        });
        draftCheckpoint = '';
        snapDraft = freshDraft();
      });
    });
    const advToggle = el('button', { class: 'toggle', textContent: `${showAdvanced ? '▾' : '▸'} Advanced snapshot options` });
    advToggle.addEventListener('click', () => { showAdvanced = !showAdvanced; render(); });
    const waitIn = el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: snapDraft.waitSeconds });
    waitIn.addEventListener('input', () => { snapDraft.waitSeconds = waitIn.value; });
    const pauseBtn = iconButton(state.paused ? ICON_PLAY : ICON_PAUSE, state.paused ? 'Resume' : 'Pause', '', busy);
    pauseBtn.addEventListener('click', () =>
      void act(async () => {
        await ask({ kind: state.paused ? 'rec:resume' : 'rec:pause' });
      }),
    );
    const stop = iconButton(ICON_STOP, 'Stop', 'stop', busy);
    stop.addEventListener('click', () => void act(async () => { await ask({ kind: 'rec:stop' }); }));
    body.append(
      el('div', { class: 'eyebrow', textContent: 'Capture' }),
      field('Snapshot name (optional)', cp),
      field('Wait before capture (seconds, default 4)', waitIn),
      advToggle,
    );
    if (showAdvanced) body.append(snapshotOptionsForm(snapDraft, render));
    body.append(el('div', { class: 'row' }, snap), el('div', { class: 'row' }, pauseBtn, stop));
    if (state.paused) {
      body.append(el('p', { class: 'hint', textContent: 'Paused: your actions on the page are not being recorded.' }));
    }
    body.append(stepList());
  } else {
    const name = el('input', { type: 'text', placeholder: 'Workflow name', value: draftName });
    name.addEventListener('input', () => { draftName = name.value; });
    const saveBtn = el('button', { class: 'primary', textContent: busy ? 'Saving…' : 'Save Workflow', disabled: busy || !hasSnapshot });
    saveBtn.addEventListener('click', () =>
      void act(async () => {
        const saved = await ask<{ name: string }>({ kind: 'rec:save', name: draftName });
        draftName = '';
        // Background cleared the recording, which hides the widget: confirm briefly.
        window.setTimeout(() => flashSaved(`✓ Saved "${saved.name}". Replay it from the Snapshots page.`), 50);
      }),
    );
    const discard = el('button', { class: 'danger', textContent: 'Discard', disabled: busy });
    discard.addEventListener('click', () => void act(async () => { await ask({ kind: 'rec:clear' }); }));
    body.append(stepList());
    if (!hasSnapshot) body.append(el('p', { class: 'hint', textContent: 'Add at least one Capture Snapshot checkpoint to save.' }));
    body.append(el('div', { class: 'row' }, name), el('div', { class: 'row' }, saveBtn, discard));
  }

  if (message) body.append(el('div', { class: `msg ${message.kind}`, textContent: message.text }));

  box.append(head, body);
  const style = el('style', { textContent: CSS });
  root.replaceChildren(style, box);
  const modal = editModal() ?? deleteModal();
  if (modal) root.append(modal);
}

/** A "saved" confirmation must outlive the state clearing that hides the widget. */
export function flashSaved(text: string) {
  ensureHost();
  message = { kind: 'ok', text };
  if (!root) return;
  const box = el('div', { class: 'box' }, el('div', { class: 'body' }, el('div', { class: 'msg ok', textContent: text })));
  applyPos(box);
  root.replaceChildren(el('style', { textContent: CSS }), box);
  window.setTimeout(() => { if (!state.active && state.steps.length === 0) removeHost(); }, 4000);
}

export function setState(next: RecordingState) {
  state = next ?? { active: false, steps: [] };
  render();
}

export async function initWidget() {
  const stored = await chrome.storage.local.get(POS_KEY);
  pos = (stored[POS_KEY] as typeof pos) ?? null;
}
