import { useEffect, useState } from 'react';
import { getStoredToken } from '../utils/tokenStorage';

/**
 * Reads the single Percy token saved from the Settings page and keeps it
 * in sync if it is changed in another extension page.
 */
export function useToken() {
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getStoredToken()
      .then((value) => {
        if (!cancelled) setToken(value);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) {
      if (area === 'local' && changes.percyToken) {
        setToken(
          typeof changes.percyToken.newValue === 'string'
            ? changes.percyToken.newValue
            : ''
        );
      }
    }

    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return { token, hasToken: token.trim() !== '', isLoading };
}
