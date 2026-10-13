import { useState } from 'react';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { useSnapshotQueue } from '../hooks/useSnapshotQueue';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { QueueCount } from '../components/QueueCount';
import { CaptureSnapshotPanel } from '../components/CaptureSnapshotPanel';
import { useToken } from '../hooks/useToken';
import { useTokenPrompt } from '../hooks/useTokenPrompt';
import { TokenSettingsPanel } from '../components/TokenSettingsPanel';
import { BrandMark } from '../components/BrandMark';
import { RecordLauncher } from '../components/RecordLauncher';

export function Popup() {
  const connectionStatus = useConnectionStatus();
  const queue = useSnapshotQueue();

  const isBackendOffline = connectionStatus === 'offline';
  const { hasToken, isLoading: isTokenLoading } = useToken();
  const [showSettings, setShowSettings] = useState(false);
  const shouldPromptForToken = useTokenPrompt(hasToken, isTokenLoading);
  const needsToken = !isTokenLoading && !hasToken;

 

  return (
    <main className="popup">
      <header className="popup__header">
        <div className="popup__brand">
          <BrandMark />

          <div className="popup__brand-text">
            <span className="popup__title">Percy</span>
            <span className="popup__subtitle">
              Local Manager
            </span>
          </div>
        </div>

        <div className="popup__header-actions">
          <ConnectionStatus status={connectionStatus} />

          <div className="tooltip-anchor">
            <button
              type="button"
              className={`icon-button${
                needsToken ? ' icon-button--attention' : ''
              }${shouldPromptForToken ? ' icon-button--pulse' : ''}`}
              aria-label={
                needsToken ? 'Set project token' : 'Token settings'
              }
              aria-describedby={needsToken ? 'token-tooltip' : undefined}
              aria-expanded={showSettings}
              onClick={() => setShowSettings((open) => !open)}
            >
              ⚙
            </button>

            {needsToken && (
              <span
                id="token-tooltip"
                className="tooltip-bubble"
                role="tooltip"
              >
                Set project token
              </span>
            )}
          </div>
        </div>
      </header>

      <div
        className="popup__accent-strip"
        aria-hidden="true"
      />

      {showSettings ? (
        <div className="popup__body">
          <TokenSettingsPanel
            hasToken={hasToken}
            onClose={() => setShowSettings(false)}
          />
        </div>
      ) : (
      <div className="popup__body">
        {isBackendOffline && (
          <div className="offline-notice" role="alert">
            <strong>Backend server is offline.</strong>
            <span>
              Start the backend server (run the <code>server</code> script
              from the Percy distributable for your OS), then reopen this
              popup or wait for it to reconnect.
            </span>
          </div>
        )}

        <QueueCount
          count={queue.count}
          isLoading={queue.isLoading}
        />

        <CaptureSnapshotPanel
          disabled={isBackendOffline}
          onCaptured={queue.refresh}
        />

        <RecordLauncher disabled={isBackendOffline} />

        <button
          className="button button--secondary button--block"
          onClick={() =>
            chrome.tabs.create({
              url: chrome.runtime.getURL('snapshots.html'),
            })
          }
          disabled={isBackendOffline}
        >
          View Snapshots
        </button>
      </div>
      )}
    </main>
  );
}