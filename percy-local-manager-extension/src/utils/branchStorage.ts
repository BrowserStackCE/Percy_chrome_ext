import type { BranchSettings } from '../types';

export const BRANCH_SETTINGS_KEY = 'percyBranchSettings';

/** Branch the backend uses when the user does not choose one. */
export const DEFAULT_BRANCH = 'percy-local-manager';

/** Empty target branch = Percy's normal base-build selection. */
export const DEFAULT_TARGET_BRANCH = '';

export const DEFAULT_BRANCH_SETTINGS: BranchSettings = {
  branch: DEFAULT_BRANCH,
  targetBranch: DEFAULT_TARGET_BRANCH,
};

/** Coerces anything read from storage into a valid BranchSettings. */
export function normalizeBranchSettings(value: unknown): BranchSettings {
  const raw = (value ?? {}) as Partial<Record<keyof BranchSettings, unknown>>;
  const branch = typeof raw.branch === 'string' ? raw.branch.trim() : '';
  const targetBranch =
    typeof raw.targetBranch === 'string' ? raw.targetBranch.trim() : '';
  return {
    // An emptied branch field falls back to the default rather than "no branch".
    branch: branch === '' ? DEFAULT_BRANCH : branch,
    targetBranch,
  };
}

/** True when the settings equal the defaults (nothing was changed). */
export function isDefaultBranchSettings(settings: BranchSettings): boolean {
  const n = normalizeBranchSettings(settings);
  return (
    n.branch === DEFAULT_BRANCH && n.targetBranch === DEFAULT_TARGET_BRANCH
  );
}

export async function getStoredBranchSettings(): Promise<BranchSettings> {
  const result = await chrome.storage.local.get(BRANCH_SETTINGS_KEY);
  return normalizeBranchSettings(result[BRANCH_SETTINGS_KEY]);
}

export async function setStoredBranchSettings(
  settings: BranchSettings
): Promise<void> {
  await chrome.storage.local.set({
    [BRANCH_SETTINGS_KEY]: normalizeBranchSettings(settings),
  });
}

export async function resetStoredBranchSettings(): Promise<void> {
  await chrome.storage.local.remove(BRANCH_SETTINGS_KEY);
}
