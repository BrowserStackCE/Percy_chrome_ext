import { ENDPOINTS } from '../utils/constants';
import type {
  Snapshot,
  BuildStatus,
  LibrarySnapshotReference,
  BranchSettings,
} from '../types';

/**
 * All communication with the Go backend lives here. This file knows nothing
 * about Percy — it only knows the backend's HTTP contract:
 *   POST   /snapshots
 *   GET    /snapshots
 *   DELETE /snapshots
 *   POST   /build/finalize
 *   GET    /health
 */

async function parseJsonOrThrow(response: Response): Promise<unknown> {
if (!response.ok) {
  const body = await response.text().catch(() => '');
  throw new Error(`Backend request failed (${response.status}): ${body || response.statusText}`);
}
return response.json().catch(() => ({}));
}

export async function checkHealth(): Promise<boolean> {
try {
  const response = await fetch(ENDPOINTS.HEALTH, { method: 'GET' });
  return response.ok;
} catch {
  return false;
}
}

export async function createSnapshot(snapshot: Snapshot): Promise<void> {
const response = await fetch(ENDPOINTS.SNAPSHOTS, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(snapshot)
});
await parseJsonOrThrow(response);
}

export async function getSnapshots(): Promise<Snapshot[]> {
const response = await fetch(ENDPOINTS.SNAPSHOTS, { method: 'GET' });
const data = await parseJsonOrThrow(response);
return Array.isArray(data) ? (data as Snapshot[]) : [];
}

export async function updateSnapshot(
  id: string,
  updates: Partial<Omit<Snapshot, 'id' | 'createdAt'>>
): Promise<Snapshot> {
  const response = await fetch(`${ENDPOINTS.SNAPSHOTS}/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  const data = await parseJsonOrThrow(response);

  return (data as { snapshot: Snapshot }).snapshot;
}

export async function deleteSnapshot(id: string): Promise<void> {
  const response = await fetch(`${ENDPOINTS.SNAPSHOTS}/${id}`, {
    method: 'DELETE',
  });

  await parseJsonOrThrow(response);
}
export async function clearSnapshots(): Promise<void> {
const response = await fetch(ENDPOINTS.SNAPSHOTS, { method: 'DELETE' });
await parseJsonOrThrow(response);
}

/** Starts the build job in the background (202). Progress comes from getBuildStatus. */
export async function finalizeBuild(
  token: string,
  branchSettings?: BranchSettings
): Promise<void> {
const response = await fetch(ENDPOINTS.FINALIZE_BUILD, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    token,
    branch: branchSettings?.branch,
    targetBranch: branchSettings?.targetBranch,
  }),
});

await parseJsonOrThrow(response);
}

export async function getBuildStatus(): Promise<BuildStatus> {
  const response = await fetch(ENDPOINTS.BUILD_STATUS, { method: 'GET' });
  return (await parseJsonOrThrow(response)) as BuildStatus;
}

export async function setLibraryToken(token: string): Promise<void> {
  const response = await fetch(ENDPOINTS.LIBRARY_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  await parseJsonOrThrow(response);
}

export async function searchLibrary(query: string): Promise<LibrarySnapshotReference[]> {
  const response = await fetch(`${ENDPOINTS.LIBRARY_SEARCH}?q=${encodeURIComponent(query)}`);
  const data = await parseJsonOrThrow(response);
  return Array.isArray(data) ? (data as LibrarySnapshotReference[]) : [];
}

export interface LibraryStatus {
  connected: boolean;
  count: number;
}

export async function getLibraryStatus(): Promise<LibraryStatus> {
  const response = await fetch(ENDPOINTS.LIBRARY_STATUS);
  return (await parseJsonOrThrow(response)) as LibraryStatus;
}

export async function getAllLibrarySnapshots(): Promise<LibrarySnapshotReference[]> {
  const response = await fetch(ENDPOINTS.LIBRARY_ALL);
  const data = await parseJsonOrThrow(response);
  return Array.isArray(data) ? (data as LibrarySnapshotReference[]) : [];
}