/**
 * Floating, draggable recorder panel shown on the page being recorded.
 * Rendered in a closed-off Shadow DOM so page styles cannot affect it and it
 * cannot affect the page. All state lives in the background worker; this file
 * is only a view plus message senders. Plain DOM (no React) to keep the content
 * script a single small bundle.
 */
import type { RecordingState, Target, WorkflowStep } from '../types/workflow';

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
    case 'snapshot': return `Snapshot: ${s.name ?? s.checkpointId ?? ''}`;
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
  root = host.attachShadow({ mode: 'closed' });
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

function stepList(editable: boolean): HTMLElement {
  if (state.steps.length === 0) return el('p', { class: 'hint', textContent: 'No steps yet. Use the page normally.' });
  const list = el('ol');
  state.steps.forEach((s) => {
    const li = el('li', { class: s.type === 'snapshot' ? 'cp' : '' }, describeStep(s));
    if (editable) {
      const x = el('button', { class: 'x', textContent: '✕', title: 'Delete step' });
      x.addEventListener('click', () =>
        void act(async () => {
          await ask({ kind: 'rec:setSteps', steps: state.steps.filter((o) => o.id !== s.id) });
        }),
      );
      li.append(x);
    }
    list.append(li);
  });
  queueMicrotask(() => { list.scrollTop = list.scrollHeight; });
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
    const cp = el('input', { type: 'text', placeholder: 'Checkpoint name (e.g. Dashboard)', value: draftCheckpoint });
    cp.addEventListener('input', () => { draftCheckpoint = cp.value; });
    const snap = el('button', { class: 'primary', textContent: 'Capture Snapshot', disabled: busy });
    snap.addEventListener('click', () =>
      void act(async () => {
        const n = state.steps.filter((s) => s.type === 'snapshot').length + 1;
        await ask({ kind: 'rec:snapshot', name: draftCheckpoint.trim() || `Checkpoint ${n}` });
        draftCheckpoint = '';
      }),
    );
    const pauseBtn = el('button', { textContent: state.paused ? 'Resume' : 'Pause', disabled: busy });
    pauseBtn.addEventListener('click', () =>
      void act(async () => {
        await ask({ kind: state.paused ? 'rec:resume' : 'rec:pause' });
      }),
    );
    const stop = el('button', { textContent: 'Stop', disabled: busy });
    stop.addEventListener('click', () => void act(async () => { await ask({ kind: 'rec:stop' }); }));
    body.append(el('div', { class: 'row' }, cp), el('div', { class: 'row' }, snap), el('div', { class: 'row' }, pauseBtn, stop));
    if (state.paused) {
      body.append(el('p', { class: 'hint', textContent: 'Paused: your actions on the page are not being recorded.' }));
    }
    body.append(stepList(false));
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
    body.append(stepList(true));
    if (!hasSnapshot) body.append(el('p', { class: 'hint', textContent: 'Add at least one Capture Snapshot checkpoint to save.' }));
    body.append(el('div', { class: 'row' }, name), el('div', { class: 'row' }, saveBtn, discard));
  }

  if (message) body.append(el('div', { class: `msg ${message.kind}`, textContent: message.text }));

  box.append(head, body);
  const style = el('style', { textContent: CSS });
  root.replaceChildren(style, box);
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
