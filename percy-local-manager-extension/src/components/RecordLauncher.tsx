import { useState } from 'react';
import { useRecorder } from '../hooks/useRecorder';
import { RecordedSteps } from './RecordedSteps';
import type { WorkflowStep } from '../types/workflow';

interface RecordLauncherProps {
  disabled: boolean;
}

/**
 * Popup entry point for workflow recording. Starting a recording closes the
 * popup; the on-page floating panel takes over from there.
 */
export function RecordLauncher({ disabled }: RecordLauncherProps) {
  const recorder = useRecorder();
  const { state } = recorder;
  const hasUnsaved = !state.active && state.steps.length > 0;
  const hasSnapshot = state.steps.some((s) => s.type === 'snapshot');

  const [workflowName, setWorkflowName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  async function handleRecord() {
    await recorder.start();
    // On failure useRecorder sets `error` and the popup stays open to show it.
    const next = (await chrome.runtime.sendMessage({ kind: 'rec:get' })) as { active?: boolean };
    if (next?.active) window.close();
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = (await chrome.runtime.sendMessage({ kind: 'rec:save', name: workflowName })) as { name?: string; error?: string };
      if (res?.error) throw new Error(res.error);
      setSavedName(res?.name ?? workflowName);
      setWorkflowName('');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleStepsChange(steps: WorkflowStep[]) {
    void recorder.setSteps(steps);
  }

  return (
    <div className="panel">
      <span className="panel__eyebrow">Workflow</span>

      {state.active ? (
        <p className="field-help" role="status">
          Recording in progress. Use the floating panel on the page.
        </p>
      ) : hasUnsaved ? (
        <>
          <RecordedSteps
            steps={state.steps}
            editable={true}
            onChange={handleStepsChange}
          />
          {!hasSnapshot && (
            <p className="field-help">Add at least one Capture Snapshot checkpoint to save.</p>
          )}
          <label className="field-label" htmlFor="workflow-name-input">
            Workflow name
          </label>
          <input
            id="workflow-name-input"
            className="text-input"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
          <div className="panel__actions">
            <button
              type="button"
              className="button button--primary button--block"
              onClick={handleSave}
              disabled={saving || !hasSnapshot}
            >
              {saving ? 'Saving…' : 'Save Workflow'}
            </button>
            <button
              type="button"
              className="button button--link button--block"
              onClick={() => void recorder.clear()}
              disabled={saving}
            >
              Discard
            </button>
          </div>
          {saveError && <p className="message message--error">{saveError}</p>}
        </>
      ) : null}

      {savedName && (
        <p className="message message--success" role="status">
          {`✓ Saved "${savedName}"`}
        </p>
      )}

      {!hasUnsaved && !state.active && (
        <>
          <button
            type="button"
            className="button button--primary button--block"
            onClick={handleRecord}
            disabled={disabled}
          >
            Record Workflow
          </button>
          <p className="field-help">Replay saved workflows from the Snapshots page.</p>
        </>
      )}

      {recorder.error && <p className="message message--error">{recorder.error}</p>}
    </div>
  );
}
