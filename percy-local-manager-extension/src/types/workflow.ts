export type StepType =
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'navigate'
  | 'waitFor'
  | 'scroll'
  | 'snapshot';

export interface Target {
  testId?: string;
  role?: string;
  name?: string;
  css?: string;
  text?: string;
  fallbacks?: Target[];
}

export interface SnapshotStepOptions {
  widths?: number[];
  minHeight?: number;
  scope?: string;
  enableJavaScript?: boolean;
  percyCSS?: string;
}

/** Default intentional wait before a recorded snapshot is captured. */
export const DEFAULT_SNAPSHOT_WAIT_MS = 4000;

export interface WorkflowStep {
  id: string;
  type: StepType;
  label?: string;
  target?: Target;
  value?: string;
  valueRef?: string;
  url?: string;
  condition?: string;
  timeoutMs?: number;
  checkpointId?: string;
  name?: string;
  scrollX?: number;
  scrollY?: number;
  /** Snapshot only: intentional wait (ms) before capturing. */
  waitMs?: number;
  /** Snapshot only: per-snapshot Percy options. */
  options?: SnapshotStepOptions;
}

export interface WorkflowSettings {
  defaultTimeoutMs?: number;
  viewport: { width: number; height: number };
}

/** Mirrors the Go workflow.Workflow JSON. */
export interface Workflow {
  workflowId?: string;
  name: string;
  schemaVersion: number;
  version?: number;
  startUrl: string;
  steps: WorkflowStep[];
  settings: WorkflowSettings;
  createdAt?: string;
  updatedAt?: string;
}

export interface RecordingState {
  active: boolean;
  /** Recording is still open but user actions are not being captured. */
  paused?: boolean;
  tabId?: number;
  startUrl?: string;
  viewport?: { width: number; height: number };
  steps: WorkflowStep[];
}

export type RecorderMessage =
  | { kind: 'rec:start' }
  | { kind: 'rec:stop' }
  | { kind: 'rec:pause' }
  | { kind: 'rec:resume' }
  | { kind: 'rec:get' }
  | { kind: 'rec:clear' }
  | { kind: 'rec:snapshot'; name: string; waitMs?: number; options?: SnapshotStepOptions }
  | { kind: 'rec:save'; name: string }
  | { kind: 'rec:setSteps'; steps: WorkflowStep[] }
  | { kind: 'rec:event'; step: Omit<WorkflowStep, 'id'> };
