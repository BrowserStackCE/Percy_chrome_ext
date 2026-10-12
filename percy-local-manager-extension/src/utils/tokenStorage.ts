const TOKEN_KEY = 'percyToken';

export async function getStoredToken(): Promise<string> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  const value = result[TOKEN_KEY];
  return typeof value === 'string' ? value : '';
}

export async function setStoredToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
  // A token now exists, so any "already prompted" record is obsolete.
  await clearTokenPrompt();
}

// ---- "Set your token" prompt tracking -------------------------------------
// We remember that the user was prompted so the notice isn't shown on every
// popup open. The record expires on its own after 24 hours.

export const TOKEN_PROMPT_KEY = 'percyTokenPromptedAt';
export const TOKEN_PROMPT_TTL_MS = 24 * 60 * 60 * 1000;

/** True if the user was already prompted within the last 24 hours. */
export async function wasRecentlyPrompted(): Promise<boolean> {
  const result = await chrome.storage.local.get(TOKEN_PROMPT_KEY);
  const promptedAt = result[TOKEN_PROMPT_KEY];

  if (typeof promptedAt !== 'number') return false;

  if (Date.now() - promptedAt >= TOKEN_PROMPT_TTL_MS) {
    await clearTokenPrompt(); // expired, clear it out automatically
    return false;
  }

  return true;
}

export async function markTokenPrompted(): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_PROMPT_KEY]: Date.now() });
}

export async function clearTokenPrompt(): Promise<void> {
  await chrome.storage.local.remove(TOKEN_PROMPT_KEY);
}
