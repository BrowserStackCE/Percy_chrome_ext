import { useEffect, useState } from 'react';
import { markTokenPrompted, wasRecentlyPrompted } from '../utils/tokenStorage';

/**
 * Decides whether to show the "set your token" prompt.
 *
 * - Only prompts when no token is set.
 * - Records the prompt in chrome.storage.local so it is not shown again on
 *   every popup open; the record expires after 24 hours.
 * - The prompt stays visible for the lifetime of this popup once shown, so it
 *   doesn't vanish while the user is looking at it.
 */
export function useTokenPrompt(hasToken: boolean, isTokenLoading: boolean) {
  const [shouldPrompt, setShouldPrompt] = useState(false);

  useEffect(() => {
    if (isTokenLoading) return;

    if (hasToken) {
      setShouldPrompt(false);
      return;
    }

    let cancelled = false;

    wasRecentlyPrompted().then(async (alreadyPrompted) => {
      if (cancelled || alreadyPrompted) return;
      setShouldPrompt(true);
      await markTokenPrompted();
    });

    return () => {
      cancelled = true;
    };
  }, [hasToken, isTokenLoading]);

  return shouldPrompt;
}
