import { ENDPOINTS } from '../utils/constants';
import type { BranchSettings } from '../types';
import type { Workflow } from '../types/workflow';
import type { StartRunResponse, WorkflowBuild } from '../types/build';

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let msg = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg || `Backend request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function listWorkflows(): Promise<Workflow[]> {
  const data = await parse<Workflow[]>(await fetch(ENDPOINTS.WORKFLOWS));
  return Array.isArray(data) ? data : [];
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return parse<Workflow>(await fetch(`${ENDPOINTS.WORKFLOWS}/${encodeURIComponent(id)}`));
}

export async function createWorkflow(workflow: Workflow): Promise<Workflow> {
  return parse<Workflow>(
    await fetch(ENDPOINTS.WORKFLOWS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
    }),
  );
}

export async function updateWorkflow(id: string, workflow: Workflow): Promise<Workflow> {
  return parse<Workflow>(
    await fetch(`${ENDPOINTS.WORKFLOWS}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
    }),
  );
}

/**
 * Starts a replay. The Percy token and any secrets are sent for this run only;
 * the backend never stores them. `idempotencyKey` makes retries safe: the same
 * key returns the already-created build instead of starting a second one.
 */
export async function startRun(
  workflowId: string,
  token: string,
  idempotencyKey: string,
  secrets?: Record<string, string>,
  branchSettings?: BranchSettings,
): Promise<StartRunResponse> {
  return parse<StartRunResponse>(
    await fetch(`${ENDPOINTS.WORKFLOWS}/${encodeURIComponent(workflowId)}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        token,
        secrets,
        branch: branchSettings?.branch,
        targetBranch: branchSettings?.targetBranch,
      }),
    }),
  );
}

export async function getBuild(buildId: string): Promise<WorkflowBuild> {
  return parse<WorkflowBuild>(await fetch(`${ENDPOINTS.BUILDS}/${encodeURIComponent(buildId)}`));
}

export async function listBuilds(): Promise<WorkflowBuild[]> {
  const data = await parse<WorkflowBuild[]>(await fetch(ENDPOINTS.BUILDS));
  return Array.isArray(data) ? data : [];
}

/** Plain-text run log (runner steps, form state at each snapshot, errors). */
export async function getBuildLog(buildId: string): Promise<string> {
  const res = await fetch(`${ENDPOINTS.BUILDS}/${encodeURIComponent(buildId)}/artifacts/logs/runner.log`);
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`Could not load logs (${res.status})`);
  return res.text();
}

export async function cancelBuild(buildId: string): Promise<void> {
  await parse<unknown>(
    await fetch(`${ENDPOINTS.BUILDS}/${encodeURIComponent(buildId)}/cancel`, { method: 'POST' }),
  );
}
