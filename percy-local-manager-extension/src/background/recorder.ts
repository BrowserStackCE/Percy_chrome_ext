/**
 * Service worker: owns recording state so it survives the popup closing.
 * State is mirrored to chrome.storage.session because MV3 workers are
 * suspended when idle.
 */
import { addSnapshot, appendStep, renumber } from '../utils/recorderCore';
import { createWorkflow } from '../services/workflowApi';
import type { RecordingState, WorkflowStep } from '../types/workflow';

const KEY = 'recordingState';
const EMPTY: RecordingState = { active: false, steps: [] };

async function load(): Promise<RecordingState> {
  const stored = await chrome.storage.session.get(KEY);
  return (stored[KEY] as RecordingState | undefined) ?? EMPTY;
}

async function save(state: RecordingState): Promise<void> {
  await chrome.storage.session.set({ [KEY]: state });
  // Keep the on-page recorder widget live (it also listens to storage, but a
  // direct message keeps it in sync across worker restarts).
  if (state.tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { kind: 'rec:state', state });
    } catch {
      /* page has no content script */
    }
  }
}

async function notifyTab(tabId: number | undefined, active: boolean) {
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, { kind: 'rec:active', active });
  } catch {
    /* content script not present on this page */
  }
}

/** Asks the page for its viewport; resolves undefined if no content script answers. */
async function askViewport(tabId: number): Promise<{ width: number; height: number } | undefined> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { kind: 'rec:viewport' })) as
      | { width: number; height: number }
      | undefined;
    return res?.width && res?.height ? res : undefined;
  } catch {
    return undefined;
  }
}

async function start(): Promise<RecordingState> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    throw new Error('Open an http(s) page in the active tab to record.');
  }
  // Pages opened before the extension was installed/reloaded have no content
  // script yet. activeTab (granted by the popup click) lets us inject it now.
  let measured = await askViewport(tab.id);
  if (!measured) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      measured = await askViewport(tab.id);
    } catch {
      throw new Error('Could not attach the recorder to this page. Reload the page and try again.');
    }
  }
  const viewport = measured ?? { width: 1280, height: 800 };
  const state: RecordingState = {
    active: true,
    tabId: tab.id,
    startUrl: tab.url,
    viewport,
    steps: [],
  };
  await save(state);
  await notifyTab(tab.id, true);
  return state;
}

async function stop(): Promise<RecordingState> {
  const state = await load();
  const next = { ...state, active: false, paused: false };
  await save(next);
  // Send the full state (with steps) so the content-script widget can render
  // the save form immediately without waiting for a page reload.
  if (state.tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { kind: 'rec:state', state: next });
    } catch {
      /* tab closed or no content script */
    }
  }
  return next;
}

async function clear(): Promise<RecordingState> {
  const state = await load();
  await notifyTab(state.tabId, false);
  await chrome.storage.session.set({ [KEY]: EMPTY });
  // EMPTY has no tabId, so tell the previously recorded tab directly: this is
  // what removes the floating panel after Save / Discard.
  if (state.tabId !== undefined) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { kind: 'rec:state', state: EMPTY });
    } catch {
      /* tab closed or no content script */
    }
  }
  return EMPTY;
}

const NEEDS_TARGET = new Set(['click', 'fill', 'select', 'check', 'uncheck']);

function hasLocator(step: Omit<WorkflowStep, 'id'>): boolean {
  const t = step.target;
  return !!(t && (t.testId || t.role || t.css || t.text));
}

/** Saves the finished recording through the Go API. Runs here, not in the page,
 * because an https page may not call http://localhost (mixed content). */
async function saveWorkflow(name: string): Promise<{ workflowId?: string; name: string }> {
  const state = await load();
  if (state.active) throw new Error('Stop recording before saving.');
  if (!state.startUrl || !state.viewport) throw new Error('Nothing recorded.');
  if (!state.steps.some((s) => s.type === 'snapshot')) {
    throw new Error('Add at least one Capture Snapshot checkpoint before saving.');
  }
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a workflow name.');
  const bad = state.steps.findIndex((s) => NEEDS_TARGET.has(s.type) && !hasLocator(s));
  if (bad >= 0) {
    throw new Error(`Step ${bad + 1} (${state.steps[bad].type}) has no locator. Delete it in the panel and save again.`);
  }
  const saved = await createWorkflow({
    name: trimmed,
    schemaVersion: 1,
    startUrl: state.startUrl,
    steps: renumber(state.steps),
    settings: { defaultTimeoutMs: 10000, viewport: state.viewport },
  });
  await clear();
  return { workflowId: saved.workflowId, name: saved.name };
}

/** Pause: keep the recording open but stop capturing user actions. */
async function pause(): Promise<RecordingState> {
  const state = await load();
  if (!state.active) throw new Error('Not recording.');
  const next = { ...state, paused: true };
  await save(next);
  await notifyTab(state.tabId, false);
  return next;
}

/**
 * Resume capturing. If the user navigated while paused, add a navigate step so
 * replay reaches the same page the following actions were recorded on.
 */
async function resume(): Promise<RecordingState> {
  const state = await load();
  if (!state.active) throw new Error('Not recording.');
  let steps = state.steps;
  if (state.tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(state.tabId);
      const lastNav = [...steps].reverse().find((s) => s.type === 'navigate')?.url ?? state.startUrl;
      if (tab.url && /^https?:/.test(tab.url) && tab.url !== lastNav) {
        steps = appendStep(steps, { type: 'navigate', url: tab.url });
      }
    } catch {
      /* tab gone: nothing to align */
    }
  }
  const next = { ...state, paused: false, steps };
  await save(next);
  await notifyTab(state.tabId, true);
  return next;
}

async function onEvent(step: Omit<WorkflowStep, 'id'>, senderTab?: number): Promise<void> {
  const state = await load();
  if (!state.active || state.paused || state.tabId !== senderTab) return;
  // A step the backend would reject (no locator) is noise, not a user action.
  if (NEEDS_TARGET.has(step.type) && !hasLocator(step)) return;
  await save({ ...state, steps: appendStep(state.steps, step) });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const run = async () => {
    switch (msg?.kind) {
      case 'rec:start':
        return start();
      case 'rec:stop':
        return stop();
      case 'rec:pause':
        return pause();
      case 'rec:resume':
        return resume();
      case 'rec:get':
        return load();
      case 'rec:clear':
        return clear();
      case 'rec:snapshot': {
        const state = await load();
        if (!state.active) throw new Error('Not recording.');
        const waitMs = typeof msg.waitMs === 'number' && msg.waitMs >= 0 && msg.waitMs <= 60000 ? Math.round(msg.waitMs) : undefined;
        const next = {
          ...state,
          steps: addSnapshot(state.steps, String(msg.name ?? ''), { waitMs, options: msg.options }),
        };
        await save(next);
        return next;
      }
      case 'rec:save':
        return saveWorkflow(String(msg.name ?? ''));
      case 'rec:setSteps': {
        const state = await load();
        await save({ ...state, steps: renumber(msg.steps as WorkflowStep[]) });
        return { ok: true };
      }
      case 'rec:event':
        await onEvent(msg.step, sender.tab?.id);
        return { ok: true };
      case 'rec:hello': {
        const state = await load();
        // Also return the state for the recorded tab so the on-page widget
        // reappears after a full-page navigation.
        const mine = state.tabId === sender.tab?.id;
        return { active: state.active && !state.paused && mine, state: mine ? state : undefined };
      }
      default:
        return undefined;
    }
  };
  run()
    .then((r) => sendResponse(r))
    .catch((e) => sendResponse({ error: String(e?.message ?? e) }));
  return true; // async response
});

// Record full-page navigations in the recorded tab as navigate steps.
chrome.webNavigation?.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const state = await load();
  if (!state.active || state.tabId !== d.tabId) return;
  // Paused: do not capture navigations or switch the page's recording back on.
  // Resume adds one navigate step if the URL changed in the meantime.
  if (state.paused) return;
  // Only user-driven navigations (typed/link/reload-like); skip the initial load and form/link
  // navigations already implied by the preceding click.
  if (d.transitionType === 'typed' || d.transitionType === 'auto_bookmark') {
    await save({ ...state, steps: appendStep(state.steps, { type: 'navigate', url: d.url }) });
  }
  await notifyTab(d.tabId, true);
});
