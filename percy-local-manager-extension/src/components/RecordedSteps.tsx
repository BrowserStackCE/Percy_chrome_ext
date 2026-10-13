import { useState } from 'react';
import type { Target, WorkflowStep } from '../types/workflow';
import { EditStepPanel } from './EditStepPanel';

interface RecordedStepsProps {
  steps: WorkflowStep[];
  editable: boolean;
  onChange: (steps: WorkflowStep[]) => void;
}

export function describeTarget(target?: Target): string {
  if (!target) return '';
  if (target.testId) return `[data-testid=${target.testId}]`;
  if (target.role && target.name) return `${target.role} "${target.name}"`;
  if (target.css) return target.css;
  if (target.text) return `text "${target.text}"`;
  return '';
}

export function describeStep(step: WorkflowStep): string {
  const where = describeTarget(step.target);
  switch (step.type) {
    case 'click':
      return `Click ${where}`;
    case 'fill':
      return step.valueRef
        ? `Fill ${where} with {${step.valueRef}}`
        : `Fill ${where}`;
    case 'select':
      return `Select "${step.value ?? ''}" in ${where}`;
    case 'check':
      return `Check ${where}`;
    case 'uncheck':
      return `Uncheck ${where}`;
    case 'navigate':
      return `Go to ${step.url ?? ''}`;
    case 'waitFor':
      return `Wait for ${where} to be ${step.condition || 'visible'}`;
    case 'scroll':
      return `Scroll to (${step.scrollX ?? 0}, ${step.scrollY ?? 0})`;
    case 'snapshot':
      return `Snapshot: ${step.name ?? step.checkpointId ?? ''}`;
    default:
      return step.type;
  }
}

export function RecordedSteps({ steps, editable, onChange }: RecordedStepsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (steps.length === 0) {
    return <p className="field-help">No steps recorded yet.</p>;
  }

  function replace(updated: WorkflowStep) {
    onChange(steps.map((s) => (s.id === updated.id ? updated : s)));
    setEditingId(null);
  }

  function remove(id: string) {
    onChange(steps.filter((s) => s.id !== id));
  }

  function move(index: number, delta: number) {
    const next = [...steps];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  }

  return (
    <ol className="recorded-steps" aria-label="Recorded steps">
      {steps.map((step, index) => (
        <li key={step.id} className="recorded-step">
          {editingId === step.id ? (
            <EditStepPanel
              step={step}
              onSave={replace}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <>
              <span
                className={`recorded-step__text${
                  step.type === 'snapshot' ? ' recorded-step__text--checkpoint' : ''
                }`}
              >
                {step.label || describeStep(step)}
              </span>
              {editable && (
                <span className="recorded-step__actions">
                  <button
                    type="button"
                    className="button button--link"
                    aria-label={`Move step ${index + 1} up`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button button--link"
                    aria-label={`Move step ${index + 1} down`}
                    onClick={() => move(index, 1)}
                    disabled={index === steps.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="button button--link"
                    aria-label={`Edit step ${index + 1}`}
                    onClick={() => setEditingId(step.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    aria-label={`Delete step ${index + 1}`}
                    onClick={() => remove(step.id)}
                  >
                    ✕
                  </button>
                </span>
              )}
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
