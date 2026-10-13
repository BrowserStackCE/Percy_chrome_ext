import { useCallback, useEffect, useState } from 'react';
import { listWorkflows } from '../services/workflowApi';
import type { Workflow } from '../types/workflow';

export function useWorkflows(enabled: boolean) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    try {
      setWorkflows(await listWorkflows());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { workflows, isLoading, error, refresh };
}
