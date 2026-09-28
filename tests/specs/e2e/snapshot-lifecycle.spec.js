// E2E test — Full snapshot lifecycle:
//   1. Health check (server is up)
//   2. Create a snapshot
//   3. List snapshots — verify it appears
//   4. Update the snapshot name
//   5. Delete the snapshot
//   6. Verify queue is empty
//
// NOTE: POST /build/finalize requires a valid PERCY_TOKEN and a running Percy
// CLI process. That step is guarded by the env var and skipped in CI when absent.
const { test, expect } = require('@playwright/test');

const PERCY_TOKEN = process.env.PERCY_TOKEN;

const SNAPSHOT_PAYLOAD = {
  name: 'E2E Homepage Snapshot',
  url: 'https://example.com',
  dom: '<!DOCTYPE html><html><head><title>E2E Test</title></head><body><h1>E2E</h1></body></html>',
  widths: [1280, 375],
  minHeight: 600,
};

test.describe('Snapshot lifecycle (E2E)', () => {
  let snapshotId;

  test.beforeAll(async ({ request }) => {
    // Ensure server is reachable before running the suite
    const health = await request.get('/health');
    expect(health.status(), 'Backend must be running on BACKEND_URL').toBe(200);
    // Clear any leftover snapshots
    await request.delete('/snapshots');
  });

  test('Step 1 — server health check passes', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  test('Step 2 — create a snapshot', async ({ request }) => {
    const res = await request.post('/snapshots', { data: SNAPSHOT_PAYLOAD });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.snapshot.id).toBeTruthy();
    snapshotId = body.snapshot.id;
    expect(body.snapshot.name).toBe(SNAPSHOT_PAYLOAD.name);
    expect(body.snapshot.url).toBe(SNAPSHOT_PAYLOAD.url);
    expect(body.snapshot.widths).toEqual(SNAPSHOT_PAYLOAD.widths);
  });

  test('Step 3 — snapshot appears in the queue', async ({ request }) => {
    const res = await request.get('/snapshots');
    expect(res.status()).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    const found = list.find((s) => s.id === snapshotId);
    expect(found, `Snapshot ${snapshotId} should be in the queue`).toBeTruthy();
    expect(found.name).toBe(SNAPSHOT_PAYLOAD.name);
  });

  test('Step 4 — update snapshot name', async ({ request }) => {
    const updatedName = 'E2E Homepage Snapshot — Updated';
    const res = await request.patch(`/snapshots/${snapshotId}`, {
      data: { name: updatedName },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.snapshot.name).toBe(updatedName);
    expect(body.snapshot.id).toBe(snapshotId);
  });

  test('Step 5 — delete the snapshot', async ({ request }) => {
    const res = await request.delete(`/snapshots/${snapshotId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Snapshot deleted');
  });

  test('Step 6 — queue is empty after deletion', async ({ request }) => {
    const res = await request.get('/snapshots');
    expect(res.status()).toBe(200);
    const list = await res.json();
    const found = list.find((s) => s.id === snapshotId);
    expect(found, 'Deleted snapshot should not appear in the queue').toBeUndefined();
  });

  // Finalize build — requires a real Percy token and a running Percy CLI process.
  // Percy CLI install + build finalization can take up to 2 minutes on first run.
  // Skipped automatically in CI when PERCY_TOKEN is not set.
  test('Step 7 — finalize build (requires PERCY_TOKEN)', async ({ request }) => {
    test.setTimeout(120_000);
    test.skip(!PERCY_TOKEN, 'PERCY_TOKEN not set — skipping finalize build test');

    // Re-create a snapshot so there is something to finalize
    const createRes = await request.post('/snapshots', { data: SNAPSHOT_PAYLOAD });
    expect(createRes.status()).toBe(201);

    const res = await request.post('/build/finalize', {
      data: { token: PERCY_TOKEN },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Percy started successfully');
    expect(body.buildId).toBeTruthy();
    expect(body.buildUrl).toBeTruthy();
  });
});
