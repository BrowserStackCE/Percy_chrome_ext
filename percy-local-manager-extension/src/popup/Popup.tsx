import { useState } from 'react';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { useSnapshotQueue } from '../hooks/useSnapshotQueue';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { QueueCount } from '../components/QueueCount';
import { CaptureSnapshotPanel } from '../components/CaptureSnapshotPanel';
import { LibraryTokenPanel } from '../components/LibraryTokenPanel';
import { LibraryMatches } from '../components/LibraryMatches';
import { BrandMark } from '../components/BrandMark';
import { useLibrarySearch } from '../hooks/useLibrarySearch';
import type { LibrarySnapshotReference } from '../types';

export function Popup() {
  const connectionStatus = useConnectionStatus();
  const queue = useSnapshotQueue();

  const isBackendOffline = connectionStatus === 'offline';

  const [libraryQuery, setLibraryQuery] = useState('');

  const { results, isSearching } = useLibrarySearch(libraryQuery);

  function openLibrary(ref?: LibrarySnapshotReference) {
    const url = new URL(
      chrome.runtime.getURL('library.html')
    );

    if (ref?.name) {
      url.searchParams.set('search', ref.name);
    }

    chrome.tabs.create({
      url: url.toString(),
    });
  }

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

        <ConnectionStatus status={connectionStatus} />
      </header>

      <div
        className="popup__accent-strip"
        aria-hidden="true"
      />

      {isBackendOffline && (
        <div className="popup__offline-banner" role="alert">
          <span>⚠️ Backend server is not running. Start the Go server to use Percy Local Manager.</span>
        </div>
      )}

      <div className="popup__body">
        <QueueCount
          count={queue.count}
          isLoading={queue.isLoading}
        />

        <LibraryTokenPanel />

        {/* Library search */}
        <div className="panel library-search-panel">
          <span className="panel__eyebrow">
            Snapshot Library
          </span>

          <input
            className="text-input"
            type="text"
            placeholder="Search snapshots..."
            value={libraryQuery}
            onChange={(event) =>
              setLibraryQuery(event.target.value)
            }
          disabled={isBackendOffline}
          />

          {libraryQuery.trim() !== '' && (
            <LibraryMatches
              results={results}
              isSearching={isSearching}
            />
          )}

          <button
            type="button"
            className="button button--link"
            onClick={() => openLibrary()}
          disabled={isBackendOffline}
          >
            Browse full library →
          </button>
        </div>

        <CaptureSnapshotPanel
          disabled={isBackendOffline}
          onCaptured={queue.refresh}
        />

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
    </main>
  );
}