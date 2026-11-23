export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'partial' | 'cancelled';
export type StepRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
export type CheckpointRunStatus = 'pending' | 'captured' | 'uploaded' | 'uploadFailed' | 'failed';

export interface StepResult {
  stepId: string;
  type: string;
  status: StepRunStatus;
  durationMs?: number;
  error?: string;
}

export interface CheckpointResult {
  checkpointId: string;
  name: string;
  status: CheckpointRunStatus;
  domPath?: string;
  metadataPath?: string;
  error?: string;
}

/** Mirrors the Go runs.Build JSON. */
export interface WorkflowBuild {
  buildId: string;
  workflowId: string;
  workflowVersion: number;
  workflowName: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStepId?: string;
  steps: StepResult[];
  checkpoints: CheckpointResult[];
  errors: { stepId?: string; message: string }[];
  percyBuildId?: string;
  percyBuildUrl?: string;
}

export interface StartRunResponse {
  buildId: string;
  status: RunStatus;
  duplicate: boolean;
}

export const isTerminal = (s: RunStatus): boolean =>
  s === 'passed' || s === 'failed' || s === 'partial' || s === 'cancelled';
