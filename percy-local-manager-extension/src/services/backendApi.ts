import { ENDPOINTS } from '../utils/constants';
import type { Snapshot, FinalizeBuildResponse ,LibrarySnapshotReference } from '../types';

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

export async function finalizeBuild(
token: string
): Promise<FinalizeBuildResponse> {
const response = await fetch(ENDPOINTS.FINALIZE_BUILD, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    token,
  }),
});

const data = await parseJsonOrThrow(response);
return data as FinalizeBuildResponse;
}

export interface FinalizeStreamCallbacks {
  onProgress: (msg: string) => void;
  onDone: (result: FinalizeBuildResponse) => void;
  onError: (msg: string) => void;
}

/**
 * Opens an SSE connection to /build/finalize/stream and calls the provided
 * callbacks as events arrive. Returns a cleanup function that closes the
 * EventSource when called.
 */
export function finalizeBuildStream(
  token: string,
  callbacks: FinalizeStreamCallbacks
): () => void {
  const url = `${ENDPOINTS.FINALIZE_BUILD}/stream?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);

  es.addEventListener('progress', (e) => {
    callbacks.onProgress((e as MessageEvent).data);
  });

  es.addEventListener('done', (e) => {
    es.close();
    try {
      const result = JSON.parse((e as MessageEvent).data) as FinalizeBuildResponse;
      callbacks.onDone(result);
    } catch {
      callbacks.onError('Received malformed completion event');
    }
  });

  // Track whether a named 'error' event already delivered a real message so
  // the generic onerror handler (which fires when the server closes the
  // connection after sending the error event) does not overwrite it.
  let namedErrorReceived = false;

  es.addEventListener('error', (e) => {
    namedErrorReceived = true;
    es.close();
    const msg = (e as MessageEvent).data || 'Percy build failed';
    callbacks.onError(msg);
  });

  // Generic onerror fires when the connection itself drops (network error or
  // server closed the stream). Only surface it when no named error arrived.
  es.onerror = () => {
    if (namedErrorReceived) return;
    es.close();
    callbacks.onError('Lost connection to backend');
  };

  return () => es.close();
}

export async function getLibraryToken(): Promise<string> {
  const response = await fetch(ENDPOINTS.LIBRARY_TOKEN, { method: 'GET' });
  const data = await parseJsonOrThrow(response);
  return (data as { token: string }).token ?? '';
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