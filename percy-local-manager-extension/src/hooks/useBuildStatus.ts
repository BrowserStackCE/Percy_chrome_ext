import { useCallback, useEffect, useRef, useState } from 'react';
import { getBuildStatus } from '../services/backendApi';
import { ENDPOINTS } from '../utils/constants';
import type { BuildStatus } from '../types';

const POLL_INTERVAL_MS = 1000;

interface UseBuildStatusResult {
  build: BuildStatus | null;
  /** Fetch once now and begin the live stream (or polling fallback). */
  refresh: () => Promise<BuildStatus | null>;
}

/**
 * Streams GET /build/stream (SSE) for real-time build progress.
 * Falls back to 1-second polling when EventSource is unavailable (e.g. some
 * extension service-worker contexts).
 * On mount it checks once so reopening the popup mid-build resumes progress.
 */
export function useBuildStatus(
  onFinished?: (status: BuildStatus) => void
): UseBuildStatusResult {
  const [build, setBuild] = useState<BuildStatus | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const unmounted = useRef(false);

  // --- polling fallback ---
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  const handleStatus = useCallback((status: BuildStatus) => {
    if (unmounted.current) return;
    setBuild(status);
    if (status.status === 'success' || status.status === 'failed') {
      finishedRef.current?.(status);
    }
  }, []);

  const pollOnce = useCallback(async (): Promise<BuildStatus | null> => {
    clearTimer();
    try {
      const status = await getBuildStatus();
      handleStatus(status);
      if (status.status === 'running') {
        timer.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
      }
      return status;
    } catch {
      if (!unmounted.current) {
        timer.current = setTimeout(pollOnce, POLL_INTERVAL_MS * 2);
      }
      return null;
    }
  }, [handleStatus]);

  // --- SSE stream ---
  const esRef = useRef<EventSource | null>(null);

  const openStream = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    if (typeof EventSource === 'undefined') return; // not available — use polling

    const es = new EventSource(ENDPOINTS.BUILD_STREAM);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const status: BuildStatus = JSON.parse(e.data as string);
        handleStatus(status);
        // Close the stream once the build reaches a terminal state.
        if (status.status === 'success' || status.status === 'failed') {
          es.close();
          esRef.current = null;
        }
      } catch { /* ignore malformed frames */ }
    };

    es.onerror = () => {
      // SSE connection dropped — fall back to polling.
      es.close();
      esRef.current = null;
      if (!unmounted.current) {
        timer.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
      }
    };
  }, [handleStatus, pollOnce]);

  const refresh = useCallback(async (): Promise<BuildStatus | null> => {
    clearTimer();
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    // Fetch once immediately so the caller gets a status right away.
    let status: BuildStatus | null = null;
    try {
      status = await getBuildStatus();
      if (status) handleStatus(status);
    } catch { /* ignore */ }

    // Open the stream regardless of current status so we catch the transition.
    if (typeof EventSource !== 'undefined') {
      openStream();
    } else if (status?.status === 'running') {
      timer.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
    }
    return status;
  }, [handleStatus, openStream, pollOnce]);

  useEffect(() => {
    unmounted.current = false;
    // Resume only if a build is already running; do not report an old result.
    getBuildStatus()
      .then((status) => {
        if (unmounted.current) return;
        if (status.status === 'running') {
          setBuild(status);
          openStream();
        }
      })
      .catch(() => undefined);

    return () => {
      unmounted.current = true;
      clearTimer();
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [openStream]);

  return { build, refresh };
}
