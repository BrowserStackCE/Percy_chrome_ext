import { useState } from 'react';
import { setLibraryToken } from '../services/backendApi';
import { setStoredToken } from '../utils/tokenStorage';

interface TokenSettingsPanelProps {
  hasToken: boolean;
  onClose: () => void;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

export function TokenSettingsPanel({
  hasToken,
  onClose,
}: TokenSettingsPanelProps) {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = token.trim();
    if (trimmed === '') return;

    setStatus('saving');
    setMessage(null);

    // Keep the token locally so build actions work.
    await setStoredToken(trimmed);

    // Also hand it to the backend for snapshot library search.
    try {
      await setLibraryToken(trimmed);
      setStatus('success');
      setMessage('Token saved.');
    } catch (err) {
      setStatus('error');
      setMessage(
        `Saved locally, but the backend could not be updated: ${
          err instanceof Error ? err.message : 'backend offline'
        }. Start the backend server and save again.`
      );
    }

    setToken('');
  }

  return (
    <div className="panel">
      <span className="panel__eyebrow">Percy Token</span>

      <label className="field-label" htmlFor="percy-token">
        {hasToken
          ? 'A token is saved. Enter a new one to replace it.'
          : 'Percy full access token'}
      </label>
      <input
        id="percy-token"
        className="text-input"
        type="password"
        autoComplete="off"
        placeholder={hasToken ? '••••••••' : 'Enter Percy token'}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={status === 'saving'}
      />

      <button
        type="button"
        className="button button--secondary button--block"
        onClick={handleSave}
        disabled={status === 'saving' || token.trim() === ''}
      >
        {status === 'saving'
          ? 'Saving...'
          : hasToken
            ? 'Update Token'
            : 'Save Token'}
      </button>

      {message && (
        <p
          className={`message ${
            status === 'error' ? 'message--error' : 'message--success'
          }`}
        >
          {message}
        </p>
      )}

      <button type="button" className="button button--link" onClick={onClose}>
        ← Back
      </button>
    </div>
  );
}
