import { useCallback, useState } from 'react';
import { finalizeBuild } from '../services/backendApi';
import { getStoredBranchSettings } from '../utils/branchStorage';
import { useBuildStatus } from './useBuildStatus';
import type { AsyncStatus, BuildStatus, FinalizeBuildResponse } from '../types';

interface UseFinalizeBuildResult {
  status: AsyncStatus;
  error: string | null;
  result: FinalizeBuildResponse | null;
  build: BuildStatus | null;
  finalize: (token: string) => Promise<void>;
  reset: () => void;
}

/**
 * Starts POST /build/finalize (async job) and tracks it via GET /build/status.
 */
export function useFinalizeBuild(
  onFinalized?: () => void
): UseFinalizeBuildResult {
  const [status, setStatus] = useState<AsyncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinalizeBuildResponse | null>(null);

  const { build, refresh } = useBuildStatus((final) => {
    if (final.status === 'success') {
      setResult({ buildId: final.buildId ?? '', buildUrl: final.buildUrl ?? '' });
      setStatus('success');
      onFinalized?.();
    } else {
      setError(final.error ?? 'Build failed.');
      setStatus('error');
    }
  });

  const finalize = useCallback(
    async (token: string) => {
      setStatus('loading');
      setError(null);
      setResult(null);

      try {
        // Read at trigger time so the build always uses what is saved.
        await finalizeBuild(token, await getStoredBranchSettings());
        await refresh();
      } catch (err) {
        setStatus('error');
        setError(
          err instanceof Error ? err.message : 'Failed to finalize build.'
        );
      }
    },
    [refresh]
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setResult(null);
  }, []);

  return { status, error, result, build, finalize, reset };
}
