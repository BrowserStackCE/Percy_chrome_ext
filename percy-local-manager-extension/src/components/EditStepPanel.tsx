import { useState } from 'react';
import type { Target, WorkflowStep } from '../types/workflow';

interface EditStepPanelProps {
  step: WorkflowStep;
  onSave: (step: WorkflowStep) => void;
  onCancel: () => void;
}

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Edits the parts of a step users actually need to tweak: label, locator,
 * value / secret reference and timeout. A literal value can never replace a
 * valueRef, so a recorded secret can't be turned into stored plaintext here.
 */
export function EditStepPanel({ step, onSave, onCancel }: EditStepPanelProps) {
  const [label, setLabel] = useState(step.label ?? '');
  const [name, setName] = useState(step.name ?? '');
  const [target, setTarget] = useState<Target>(step.target ?? {});
  const [value, setValue] = useState(step.value ?? '');
  const [valueRef, setValueRef] = useState(step.valueRef ?? '');
  const [timeout, setTimeoutMs] = useState(step.timeoutMs ? String(step.timeoutMs) : '');
  const [error, setError] = useState<string | null>(null);

  const usesRef = Boolean(step.valueRef);
  const hasValue = step.type === 'fill' || step.type === 'select';
  const hasTarget = Boolean(step.target);

  function setTargetField(key: keyof Target, v: string) {
    setTarget((t) => ({ ...t, [key]: v || undefined }));
  }

  function save() {
    if (usesRef && !REF_PATTERN.test(valueRef)) {
      setError('Reference must be letters, digits and underscores (not starting with a digit).');
      return;
    }
    const ms = timeout === '' ? undefined : Number(timeout);
    if (ms !== undefined && (!Number.isFinite(ms) || ms < 0 || ms > 300000)) {
      setError('Timeout must be between 0 and 300000 ms.');
      return;
    }
    if (step.type === 'snapshot' && !name.trim()) {
      setError('Snapshot name is required.');
      return;
    }
    const updated: WorkflowStep = {
      ...step,
      label: label.trim() || undefined,
      timeoutMs: ms || undefined,
    };
    if (hasTarget) updated.target = target;
    if (hasValue) {
      if (usesRef) updated.valueRef = valueRef;
      else updated.value = value;
    }
    if (step.type === 'snapshot') updated.name = name.trim();
    onSave(updated);
  }

  const id = step.id;
  return (
    <div className="edit-step">
      <label className="field-label" htmlFor={`${id}-label`}>
        Label
      </label>
      <input
        id={`${id}-label`}
        className="text-input"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />

      {step.type === 'snapshot' && (
        <>
          <label className="field-label" htmlFor={`${id}-name`}>
            Snapshot name
          </label>
          <input
            id={`${id}-name`}
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </>
      )}

      {hasTarget && (
        <>
          <label className="field-label" htmlFor={`${id}-testid`}>
            Test ID
          </label>
          <input
            id={`${id}-testid`}
            className="text-input"
            value={target.testId ?? ''}
            onChange={(e) => setTargetField('testId', e.target.value)}
          />
          <label className="field-label" htmlFor={`${id}-role`}>
            Role
          </label>
          <input
            id={`${id}-role`}
            className="text-input"
            value={target.role ?? ''}
            onChange={(e) => setTargetField('role', e.target.value)}
          />
          <label className="field-label" htmlFor={`${id}-tname`}>
            Accessible name
          </label>
          <input
            id={`${id}-tname`}
            className="text-input"
            value={target.name ?? ''}
            onChange={(e) => setTargetField('name', e.target.value)}
          />
          <label className="field-label" htmlFor={`${id}-css`}>
            CSS selector
          </label>
          <input
            id={`${id}-css`}
            className="text-input"
            value={target.css ?? ''}
            onChange={(e) => setTargetField('css', e.target.value)}
          />
        </>
      )}

      {hasValue &&
        (usesRef ? (
          <>
            <label className="field-label" htmlFor={`${id}-ref`}>
              Secret reference
            </label>
            <input
              id={`${id}-ref`}
              className="text-input"
              value={valueRef}
              onChange={(e) => setValueRef(e.target.value)}
            />
            <p className="field-help">Resolved when the workflow is replayed. The value is never saved.</p>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor={`${id}-value`}>
              Value
            </label>
            <input
              id={`${id}-value`}
              className="text-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </>
        ))}

      <label className="field-label" htmlFor={`${id}-timeout`}>
        Timeout (ms)
      </label>
      <input
        id={`${id}-timeout`}
        className="text-input"
        type="number"
        min={0}
        max={300000}
        value={timeout}
        onChange={(e) => setTimeoutMs(e.target.value)}
      />

      {error && <p className="message message--error">{error}</p>}

      <div className="edit-step__actions">
        <button type="button" className="button button--primary" onClick={save}>
          Save step
        </button>
        <button type="button" className="button button--link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
