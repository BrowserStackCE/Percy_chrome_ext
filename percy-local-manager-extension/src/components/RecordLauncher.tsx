import { useRecorder } from '../hooks/useRecorder';

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

  async function handleRecord() {
    await recorder.start();
    // On failure useRecorder sets `error` and the popup stays open to show it.
    const next = (await chrome.runtime.sendMessage({ kind: 'rec:get' })) as { active?: boolean };
    if (next?.active) window.close();
  }

  return (
    <div className="panel">
      <span className="panel__eyebrow">Workflow</span>

      {state.active ? (
        <p className="field-help" role="status">
          Recording in progress. Use the floating panel on the page.
        </p>
      ) : hasUnsaved ? (
        <p className="field-help" role="status">
          A finished recording ({state.steps.length} steps) is waiting to be saved from the floating panel.
        </p>
      ) : null}

      <button
        type="button"
        className="button button--primary button--block"
        onClick={handleRecord}
        disabled={disabled || state.active || hasUnsaved}
      >
        Record Workflow
      </button>

      {recorder.error && <p className="message message--error">{recorder.error}</p>}
      <p className="field-help">Replay saved workflows from the Snapshots page.</p>
    </div>
  );
}
