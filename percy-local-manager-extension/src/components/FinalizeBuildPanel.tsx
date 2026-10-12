import { createPortal } from 'react-dom';
import { useFinalizeBuild } from '../hooks/useFinalizeBuild';
import { BuildProgress } from './BuildProgress';

interface FinalizeBuildPanelProps {
  token: string;
  disabled: boolean;
  onFinalized: () => void;
  /**
   * Optional element to render the progress card into, so a page can place it
   * outside its action bar. Falls back to rendering inline.
   */
  progressHost?: HTMLElement | null;
}

export function FinalizeBuildPanel({
  token,
  disabled,
  onFinalized,
  progressHost,
}: FinalizeBuildPanelProps) {
  const { status, error, result, build, finalize } =
    useFinalizeBuild(onFinalized);

  const isRunning = status === 'loading' || build?.status === 'running';
  const progress =
    build && build.status !== 'idle' ? <BuildProgress build={build} /> : null;

  function handleOpenBuild() {
    if (result?.buildUrl) {
      chrome.tabs.create({ url: result.buildUrl });
    }
  }

  return (
    <div className="finalize-build">
      <div className="finalize-build__actions">
        <button
          className="button button--primary"
          onClick={() => finalize(token)}
          disabled={disabled || isRunning || token.trim() === ''}
        >
          {isRunning ? 'Finalizing Build…' : 'Finalize Build'}
        </button>

        {status === 'success' && result && (
          <div className="finalize-result">
            <p className="message message--success">✓ Build finished</p>

            <button className="button button--link" onClick={handleOpenBuild}>
              Open Percy Build →
            </button>
          </div>
        )}

        {/* When the progress card is showing, it carries the error itself. */}
        {status === 'error' && !progress && (
          <p className="message message--error">{error}</p>
        )}
      </div>

      {progress &&
        (progressHost ? createPortal(progress, progressHost) : progress)}
    </div>
  );
}
