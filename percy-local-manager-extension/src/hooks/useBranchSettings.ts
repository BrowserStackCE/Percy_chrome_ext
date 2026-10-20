import { useCallback, useEffect, useState } from 'react';
import {
  BRANCH_SETTINGS_KEY,
  DEFAULT_BRANCH_SETTINGS,
  getStoredBranchSettings,
  isDefaultBranchSettings,
  normalizeBranchSettings,
  resetStoredBranchSettings,
  setStoredBranchSettings,
} from '../utils/branchStorage';
import type { BranchSettings } from '../types';

/**
 * Reads the saved branch / target branch, keeps it in sync across extension
 * pages, and saves edits. Settings are stored once and reused by both the
 * Finalize Build and the workflow Replay actions.
 */
export function useBranchSettings() {
  const [settings, setSettings] = useState<BranchSettings>(
    DEFAULT_BRANCH_SETTINGS
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    getStoredBranchSettings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) {
      if (area === 'local' && changes[BRANCH_SETTINGS_KEY]) {
        setSettings(normalizeBranchSettings(changes[BRANCH_SETTINGS_KEY].newValue));
      }
    }

    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  /** Updates local state immediately and persists the edit. */
  const update = useCallback((next: BranchSettings) => {
    setSettings(next);
    void setStoredBranchSettings(next);
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_BRANCH_SETTINGS);
    void resetStoredBranchSettings();
  }, []);

  return {
    settings,
    isLoading,
    isDefault: isDefaultBranchSettings(settings),
    update,
    reset,
  };
}
