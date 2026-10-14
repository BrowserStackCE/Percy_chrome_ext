import type { SnapshotStepOptions, StepType, Target, WorkflowStep } from '../types/workflow';

/**
 * Pure helpers shared by the content script (inlined at build time by Vite)
 * and the background worker. Nothing here touches chrome.* or the DOM.
 */

const SENSITIVE_HINT = /pass(word|wd)?|secret|token|otp|cvv|card|ssn/i;

export function isSensitiveField(attrs: {
  type?: string | null;
  name?: string | null;
  id?: string | null;
  autocomplete?: string | null;
  label?: string | null;
}): boolean {
  if ((attrs.type ?? '').toLowerCase() === 'password') return true;
  const ac = attrs.autocomplete ?? '';
  if (/password|cc-/i.test(ac)) return true;
  return [attrs.name, attrs.id, attrs.label].some((v) => !!v && SENSITIVE_HINT.test(v));
}

/** valueRef names must match the Go validator: ^[A-Za-z_][A-Za-z0-9_]{0,63}$ */
export function toValueRef(hint: string): string {
  const cleaned = hint.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const ref = /^[A-Za-z_]/.test(cleaned) ? cleaned : `v_${cleaned}`;
  return (ref || 'value').slice(0, 64);
}

/**
 * True for ids that frameworks generate per page load (react-select-6-option-0,
 * :r1:, radix-:r2:, headlessui-menu-button-3, mui-12345, uuid-like, ...). Such
 * ids differ on replay, so they must never be used as a locator.
 */
export function isGeneratedId(id: string): boolean {
  if (!id) return true;
  if (/\d{4,}/.test(id)) return true; // long digit run (timestamps, counters)
  if (/^:[^:]+:$/.test(id) || /(^|[-_]):r[0-9a-z]+:/i.test(id)) return true; // React useId
  if (/^(react-select|rc-|radix-|headlessui-|mui-|ember|ext-gen|yui_|downshift-|select2-|__next)/i.test(id)) return true;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(id)) return true; // uuid
  if (/[-_]\d+([-_]\d+)*$/.test(id) && /[-_]\d+[-_]/.test(id)) return true; // name-6-option-0-0
  return false;
}

/**
 * True for CSS classes that are build-generated or state-driven (CSS-in-JS
 * hashes, CSS-module suffixes, state toggles). They change between builds or
 * while the user interacts, so they are never used as a locator.
 */
export function isUnstableClass(cls: string): boolean {
  if (!cls) return true;
  if (/^(css|sc|jsx|svelte|emotion|styled)-/i.test(cls)) return true;
  if (/_[A-Za-z0-9]{5,}$/.test(cls) && /[0-9]/.test(cls.split('_').pop() ?? '')) return true; // CSS-module hash
  if (/\d{3,}/.test(cls)) return true;
  if (/^(active|selected|open|opened|closed|hover|focus|focused|disabled|enabled|show|shown|hide|hidden|visible|loading|loaded|checked|expanded|collapsed|current|is-.+|has-.+|ng-.+|js-.+)$/i.test(cls)) return true;
  if (/^[a-z]{1,2}[A-Z0-9][A-Za-z0-9]{4,}$/.test(cls)) return true; // minified e.g. aB3xYz
  return false;
}

/**
 * True for text that changes between visits (counters, prices, dates, bare
 * numbers) or is too short to identify an element ("X", "0", "+").
 */
export function isDynamicText(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  if (/^[\d\s.,:/$\u20ac\u00a3\u00a5%+\-()]+$/.test(t)) return true;
  if (/\d{2,}/.test(t) && t.length <= 12) return true;
  return false;
}

/** Drop duplicate candidates, keeping the first (highest-priority) occurrence. */
export function dedupeTargets(list: Target[]): Target[] {
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const t of list) {
    const { fallbacks: _f, ...own } = t;
    const key = JSON.stringify(own);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(own);
  }
  return out;
}

/**
 * Ordered locator preference: test id, role+name, then extra stable css
 * candidates (id, attributes, stable classes, scoped paths), then text. Extra
 * css candidates are passed in `cssList`, best first.
 */
export function rankTarget(candidates: Target, cssList: string[] = []): Target {
  const all: Target[] = [];
  if (candidates.testId) all.push({ testId: candidates.testId });
  if (candidates.role && candidates.name) all.push({ role: candidates.role, name: candidates.name });
  if (candidates.css) all.push({ css: candidates.css });
  for (const c of cssList) all.push({ css: c });
  if (candidates.text) all.push({ text: candidates.text });
  if (all.length === 0) return candidates;
  const [primary, ...rest] = dedupeTargets(all);
  return rest.length ? { ...primary, fallbacks: rest } : primary;
}

/** Stable id like step_001. */
export function stepId(index: number): string {
  return `step_${String(index + 1).padStart(3, '0')}`;
}

/** Checkpoint ids must match ^[A-Za-z0-9_-]{1,64}$ and be unique. */
export function checkpointIdFor(name: string, existing: string[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50) || 'checkpoint';
  let id = base;
  let n = 2;
  while (existing.includes(id)) id = `${base}_${n++}`;
  return id;
}

export function appendStep(
  steps: WorkflowStep[],
  step: Omit<WorkflowStep, 'id'>,
): WorkflowStep[] {
  const last = steps[steps.length - 1];
  // Collapse consecutive fills on the same field into the latest value.
  if (
    last &&
    step.type === 'fill' &&
    last.type === 'fill' &&
    JSON.stringify(last.target) === JSON.stringify(step.target)
  ) {
    return [...steps.slice(0, -1), { ...step, id: last.id }];
  }
  // Collapse consecutive scrolls.
  if (last && step.type === 'scroll' && last.type === 'scroll') {
    return [...steps.slice(0, -1), { ...step, id: last.id }];
  }
  return [...steps, { ...step, id: stepId(steps.length) } as WorkflowStep];
}

export function addSnapshot(
  steps: WorkflowStep[],
  name: string,
  extras: { waitMs?: number; options?: SnapshotStepOptions } = {},
): WorkflowStep[] {
  const existing = steps.filter((s) => s.type === 'snapshot').map((s) => s.checkpointId ?? '');
  const step: WorkflowStep = {
    id: stepId(steps.length),
    type: 'snapshot' as StepType,
    checkpointId: checkpointIdFor(name, existing),
    name: name.trim() || 'Snapshot',
    waitMs: extras.waitMs ?? 4000,
  };
  if (extras.options && Object.keys(extras.options).length > 0) step.options = extras.options;
  return [...steps, step];
}

/** Re-number ids after edits/deletes so they stay unique and ordered. */
export function renumber(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((s, i) => ({ ...s, id: stepId(i) }));
}
