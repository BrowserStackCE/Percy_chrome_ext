import { useRef, useEffect } from 'react';
import { useFinalizeBuild } from '../hooks/useFinalizeBuild';

interface FinalizeBuildPanelProps {
  token: string;
  disabled: boolean;
  onFinalized: () => void;
}

export function FinalizeBuildPanel({
  token,
  disabled,
  onFinalized,
}: FinalizeBuildPanelProps) {
  const { status, logs, error, result, finalize, reset } = useFinalizeBuild(onFinalized);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const isFinalizing = status === 'loading';
  const isError = status === 'error';
  const isSuccess = status === 'success';

  // Auto-scroll log to bottom as new lines arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function handleOpenBuild() {
    if (result?.buildUrl) {
      chrome.tabs.create({ url: result.buildUrl });
    }
  }

  return (
    <div className="finalize-build">
      {/* Primary action / retry button */}
      {!isFinalizing && (
        <button
          className="button button--primary button--block"
          onClick={() => {
            if (isError) reset();
            finalize(token);
          }}
          disabled={disabled || token.trim() === ''}
        >
          {isError ? '↺ Retry Finalize' : 'Finalize Build'}
        </button>
      )}

      {/* In-progress: spinner button + progress bar + live log */}
      {isFinalizing && (
        <>
          <button
            className="button button--primary button--block"
            disabled
          >
            <span className="finalize-spinner" aria-hidden="true" />
            Finalizing Build…
          </button>

          <div className="finalize-progress" role="status" aria-live="polite">
            <div className="finalize-progress__bar">
              <div className="finalize-progress__fill" />
            </div>
          </div>
        </>
      )}

      {/* Live log — shown while running and after completion/error */}
      {logs.length > 0 && (
        <div className="finalize-log" aria-label="Build progress log">
          {logs.map((line, i) => (
            <div key={i} className="finalize-log__line">{line}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Success */}
      {isSuccess && result && (
        <div className="finalize-result">
          <p className="message message--success">✓ Build finished successfully</p>
          <button className="button button--link" onClick={handleOpenBuild}>
            Open Percy Build →
          </button>
        </div>
      )}

      {/* Error: message + retry */}
      {isError && (
        <div className="finalize-error">
          <p className="message message--error">⚠ {error}</p>
        </div>
      )}
    </div>
  );
}