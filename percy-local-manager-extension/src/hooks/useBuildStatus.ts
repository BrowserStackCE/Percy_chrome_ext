import { useCallback, useEffect, useRef, useState } from 'react';
import { getBuildStatus } from '../services/backendApi';
import type { BuildStatus } from '../types';

const POLL_INTERVAL_MS = 1000;

interface UseBuildStatusResult {
  build: BuildStatus | null;
  /** Fetch once now and begin polling while the job is running. */
  refresh: () => Promise<BuildStatus | null>;
}

/**
 * Polls GET /build/status every second while a build is running.
 * On mount it checks once, so reopening the popup mid-build resumes progress.
 */
export function useBuildStatus(
  onFinished?: (status: BuildStatus) => void
): UseBuildStatusResult {
  const [build, setBuild] = useState<BuildStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const unmounted = useRef(false);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const refresh = useCallback(async (): Promise<BuildStatus | null> => {
    clearTimer();
    try {
      const status = await getBuildStatus();
      if (unmounted.current) return status;
      setBuild(status);
      if (status.status === 'running') {
        timer.current = setTimeout(refresh, POLL_INTERVAL_MS);
      } else if (status.status === 'success' || status.status === 'failed') {
        finishedRef.current?.(status);
      }
      return status;
    } catch {
      // Backend briefly unreachable: keep trying while we think a build runs.
      if (!unmounted.current) {
        timer.current = setTimeout(refresh, POLL_INTERVAL_MS * 2);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    unmounted.current = false;
    // Resume only if a build is already running; do not report an old result.
    getBuildStatus()
      .then((status) => {
        if (unmounted.current) return;
        if (status.status === 'running') {
          setBuild(status);
          timer.current = setTimeout(refresh, POLL_INTERVAL_MS);
        }
      })
      .catch(() => undefined);
    return () => {
      unmounted.current = true;
      clearTimer();
    };
  }, [refresh]);

  return { build, refresh };
}
