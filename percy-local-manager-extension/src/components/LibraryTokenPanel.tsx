import { useState } from 'react';
import { useLibraryToken } from '../hooks/useLibraryToken';

export function LibraryTokenPanel() {
  const { isConnected, count, isChecking, saveStatus, error, saveToken } = useLibraryToken();
  const [token, setToken] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const isSaving = saveStatus === 'loading';

  if (isChecking) return null; // avoid a flash of the input before we know

  if (isConnected && !isEditing) {
    return (
      <div className="panel panel--compact">
        <div className="library-connected">
          <span className="library-connected__dot" aria-hidden="true" />
          <span>Library connected · {count} snapshots</span>
        </div>
        <button className="button button--link" onClick={() => setIsEditing(true)}>
          Change token
        </button>
      </div>
    );
  }

  return (
    <div className="panel">
      <span className="panel__eyebrow">Percy Token</span>
      <label className="field-label" htmlFor="library-token">
        Percy token (full access)
      </label>
      <input
        id="library-token"
        className="text-input"
        type="password"
        placeholder="Full access token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={isSaving}
      />
      <button
        className="button button--secondary button--block"
        onClick={async () => {
          await saveToken(token);
          setIsEditing(false);
        }}
        disabled={isSaving || token.trim() === ''}
      >
        {isSaving ? 'Connecting...' : 'Connect Library'}
      </button>
      {saveStatus === 'error' && <p className="message message--error">{error}</p>}
    </div>
  );
}