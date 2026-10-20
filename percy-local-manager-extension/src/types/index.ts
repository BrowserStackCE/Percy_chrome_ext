/**
 * Snapshot payload sent to the Go backend.
 * This mirrors the backend's expected request body for POST /snapshots.
 * The extension never adds Percy-specific fields here.
 */
export interface Snapshot {
  id?: string;

  name: string;
  url: string;
  dom: string;

  widths: number[];
  minHeight: number;

  enableJavaScript: boolean;
  percyCSS?: string;
  scope?: string;

  createdAt?: string;
}

/**
 * Options used when capturing or updating a snapshot.
 */
export interface SnapshotOptions {
  name?: string;
  widths?: number[];
  minHeight?: number;
  percyCss?: string;
  scope?: string;
  enableJavaScript?: boolean;
}
/**
 * Raw browser state captured from the active tab, before a name is attached.
 */
export interface CapturedPageState {
  url: string;
  dom: string;
  viewportWidth: number;
  viewportHeight: number;
}

/**
 * Response from POST /build/finalize.
 * The extension treats this as an opaque result of a backend-managed
 * process — it never inspects Percy build internals.
 */
export interface FinalizeBuildResponse {
  buildId: string;
  buildUrl: string;
}

export type BuildRunStatus = 'idle' | 'running' | 'success' | 'failed';
export type BuildPhase =
  | 'installing'
  | 'starting'
  | 'uploading'
  | 'processing'
  | 'done';
export type SnapshotUploadState = 'pending' | 'sending' | 'sent' | 'failed';
export type BuildLogLevel = 'info' | 'warn' | 'error';

export interface BuildLogEntry {
  ts: string;
  level: BuildLogLevel;
  line: string;
}

export interface SnapshotProgress {
  id: string;
  name: string;
  state: SnapshotUploadState;
  error?: string;
}

/**
 * Response from GET /build/status.
 */
export interface BuildStatus {
  status: BuildRunStatus;
  phase?: BuildPhase;
  total: number;
  sent: number;
  snapshots: SnapshotProgress[];
  logs: BuildLogEntry[];
  error?: string;
  buildId?: string;
  buildUrl?: string;
}


/**
 * Connection status against GET /health.
 */
export type ConnectionStatus = 'checking' | 'connected' | 'offline';

/**
 * Generic async lifecycle status used by capture/finalize hooks.
 */
export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Percy branch settings sent with every build. `branch` maps to PERCY_BRANCH
 * (default `percy-local-manager`); `targetBranch` maps to PERCY_TARGET_BRANCH
 * (empty = Percy's normal base-build selection).
 */
export interface BranchSettings {
  branch: string;
  targetBranch: string;
}


export interface LibraryComparison {
  id: string;
  width: number;
  height: number;
  previewUrl: string;
}

export interface LibrarySnapshotReference {
  id: string;
  name: string;
  buildId: string;
  enableJavaScript: boolean;
  comparisons: LibraryComparison[];
}