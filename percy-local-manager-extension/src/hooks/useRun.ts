import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelBuild, getBuild, startRun } from '../services/workflowApi';
import { getStoredBranchSettings } from '../utils/branchStorage';
import { isTerminal, type WorkflowBuild } from '../types/build';

const ACTIVE_KEY = 'activeBuildId';
const POLL_MS = 1500;

function newKey(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Starts a replay and follows it to completion. The active build id lives in
 * chrome.storage.session, so reopening the popup resumes progress display.
 */
export function useRun(token: string, onFinished?: () => void) {
  const [build, setBuild] = useState<WorkflowBuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const finishedFor = useRef<string | null>(null);
  // Keep the latest callback in a ref so `follow` keeps a stable identity. A
  // new function identity on every render would re-run the resume effect and
  // restart polling in a tight loop.
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const stopPolling = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const follow = useCallback(
    (buildId: string) => {
      stopPolling();
      const tick = async () => {
        try {
          const b = await getBuild(buildId);
          setBuild(b);
          if (isTerminal(b.status)) {
            await chrome.storage.session.remove(ACTIVE_KEY);
            if (finishedFor.current !== buildId) {
              finishedFor.current = buildId;
              onFinishedRef.current?.();
            }
            return;
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
        timer.current = window.setTimeout(tick, POLL_MS);
      };
      void tick();
    },
    [stopPolling],
  );

  // Resume a run that was in progress when the popup was last closed.
  useEffect(() => {
    void chrome.storage.session.get(ACTIVE_KEY).then((s) => {
      const id = s[ACTIVE_KEY] as string | undefined;
      if (id) follow(id);
    });
    return stopPolling;
  }, [follow, stopPolling]);

  const start = useCallback(
    async (workflowId: string, secrets?: Record<string, string>) => {
      setError(null);
      setStarting(true);
      try {
        // Read at trigger time so the run always uses what is saved.
        const res = await startRun(
          workflowId,
          token,
          newKey(),
          secrets,
          await getStoredBranchSettings(),
        );
        await chrome.storage.session.set({ [ACTIVE_KEY]: res.buildId });
        follow(res.buildId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStarting(false);
      }
    },
    [follow, token],
  );

  const cancel = useCallback(async () => {
    if (!build) return;
    try {
      await cancelBuild(build.buildId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [build]);

  const dismiss = useCallback(() => {
    stopPolling();
    setBuild(null);
    void chrome.storage.session.remove(ACTIVE_KEY);
  }, [stopPolling]);

  return {
    build,
    error,
    starting,
    running: build !== null && !isTerminal(build.status),
    start,
    cancel,
    dismiss,
  };
}
