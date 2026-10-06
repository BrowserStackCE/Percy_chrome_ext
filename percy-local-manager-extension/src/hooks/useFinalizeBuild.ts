import { useCallback, useRef, useState } from 'react';
import { finalizeBuildStream } from '../services/backendApi';
import type { AsyncStatus, FinalizeBuildResponse } from '../types';

interface UseFinalizeBuildResult {
  status: AsyncStatus;
  logs: string[];
  error: string | null;
  result: FinalizeBuildResponse | null;
  finalize: (token: string) => void;
  reset: () => void;
}

/**
 * Streams build progress from GET /build/finalize/stream (SSE).
 */
export function useFinalizeBuild(
  onFinalized?: () => void
): UseFinalizeBuildResult {
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinalizeBuildResponse | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const finalize = useCallback(
    (token: string) => {
      // Close any previous stream
      cleanupRef.current?.();

      setStatus('loading');
      setLogs([]);
      setError(null);
      setResult(null);

      const cleanup = finalizeBuildStream(token, {
        onProgress(msg) {
          setLogs((prev) => [...prev, msg]);
        },
        onDone(res) {
          setResult(res);
          setStatus('success');
          onFinalized?.();
        },
        onError(msg) {
          setError(msg);
          setStatus('error');
        },
      });

      cleanupRef.current = cleanup;
    },
    [onFinalized]
  );

  const reset = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setStatus('idle');
    setLogs([]);
    setError(null);
    setResult(null);
  }, []);

  return { status, logs, error, result, finalize, reset };
}