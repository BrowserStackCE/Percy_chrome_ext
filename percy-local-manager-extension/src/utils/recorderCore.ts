import type { StepType, Target, WorkflowStep } from '../types/workflow';

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

/** Ordered locator preference: test id, role+name, id/css, text. */
export function rankTarget(candidates: Target): Target {
  const all: Target[] = [];
  if (candidates.testId) all.push({ testId: candidates.testId });
  if (candidates.role && candidates.name) all.push({ role: candidates.role, name: candidates.name });
  if (candidates.css) all.push({ css: candidates.css });
  if (candidates.text) all.push({ text: candidates.text });
  if (all.length === 0) return candidates;
  const [primary, ...rest] = all;
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

export function addSnapshot(steps: WorkflowStep[], name: string): WorkflowStep[] {
  const existing = steps.filter((s) => s.type === 'snapshot').map((s) => s.checkpointId ?? '');
  return [
    ...steps,
    {
      id: stepId(steps.length),
      type: 'snapshot' as StepType,
      checkpointId: checkpointIdFor(name, existing),
      name: name.trim() || 'Snapshot',
    },
  ];
}

/** Re-number ids after edits/deletes so they stay unique and ordered. */
export function renumber(steps: WorkflowStep[]): WorkflowStep[] {
  return steps.map((s, i) => ({ ...s, id: stepId(i) }));
}
