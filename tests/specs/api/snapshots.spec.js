// API tests — Snapshot CRUD: POST /snapshots, GET /snapshots,
//   PATCH /snapshots/:id, DELETE /snapshots/:id, DELETE /snapshots
const { test, expect } = require('@playwright/test');

const VALID_SNAPSHOT = {
  name: 'Test Snapshot',
  url: 'https://example.com',
  dom: '<html><body><h1>Hello</h1></body></html>',
  widths: [1280],
  minHeight: 768,
};

test.describe('Snapshot CRUD', () => {
  // Clear queue before each test so tests are independent
  test.beforeEach(async ({ request }) => {
    await request.delete('/snapshots');
  });

  test('POST /snapshots creates a snapshot and returns 201', async ({ request }) => {
    const res = await request.post('/snapshots', { data: VALID_SNAPSHOT });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.message).toBe('Snapshot created');
    expect(body.snapshot.id).toBeTruthy();
    expect(body.snapshot.name).toBe(VALID_SNAPSHOT.name);
    expect(body.snapshot.url).toBe(VALID_SNAPSHOT.url);
    expect(body.snapshot.widths).toEqual(VALID_SNAPSHOT.widths);
  });

  test('POST /snapshots returns 400 when name is missing', async ({ request }) => {
    const { name, ...withoutName } = VALID_SNAPSHOT;
    const res = await request.post('/snapshots', { data: withoutName });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('POST /snapshots returns 400 when url is missing', async ({ request }) => {
    const { url, ...withoutUrl } = VALID_SNAPSHOT;
    const res = await request.post('/snapshots', { data: withoutUrl });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('POST /snapshots returns 400 when dom is missing', async ({ request }) => {
    const { dom, ...withoutDom } = VALID_SNAPSHOT;
    const res = await request.post('/snapshots', { data: withoutDom });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('POST /snapshots returns 400 when widths is missing', async ({ request }) => {
    const { widths, ...withoutWidths } = VALID_SNAPSHOT;
    const res = await request.post('/snapshots', { data: withoutWidths });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('GET /snapshots returns array of queued snapshots', async ({ request }) => {
    // Create two snapshots first
    await request.post('/snapshots', { data: VALID_SNAPSHOT });
    await request.post('/snapshots', {
      data: { ...VALID_SNAPSHOT, name: 'Second Snapshot' },
    });

    const res = await request.get('/snapshots');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  test('GET /snapshots returns empty array when queue is clear', async ({ request }) => {
    const res = await request.get('/snapshots');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test('PATCH /snapshots/:id updates snapshot name', async ({ request }) => {
    // Create a snapshot to update
    const createRes = await request.post('/snapshots', { data: VALID_SNAPSHOT });
    const { snapshot } = await createRes.json();

    const res = await request.patch(`/snapshots/${snapshot.id}`, {
      data: { name: 'Updated Name' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Snapshot updated');
    expect(body.snapshot.name).toBe('Updated Name');
    expect(body.snapshot.id).toBe(snapshot.id);
  });

  test('PATCH /snapshots/:id returns 404 for unknown id', async ({ request }) => {
    const res = await request.patch('/snapshots/nonexistent-id-xyz', {
      data: { name: 'New Name' },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('PATCH /snapshots/:id returns 400 when name is empty string', async ({ request }) => {
    const createRes = await request.post('/snapshots', { data: VALID_SNAPSHOT });
    const { snapshot } = await createRes.json();

    const res = await request.patch(`/snapshots/${snapshot.id}`, {
      data: { name: '' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('DELETE /snapshots/:id deletes a specific snapshot', async ({ request }) => {
    const createRes = await request.post('/snapshots', { data: VALID_SNAPSHOT });
    const { snapshot } = await createRes.json();

    const deleteRes = await request.delete(`/snapshots/${snapshot.id}`);
    expect(deleteRes.status()).toBe(200);
    const body = await deleteRes.json();
    expect(body.message).toBe('Snapshot deleted');

    // Verify it's gone
    const listRes = await request.get('/snapshots');
    const list = await listRes.json();
    expect(list.find((s) => s.id === snapshot.id)).toBeUndefined();
  });

  test('DELETE /snapshots/:id returns 404 for unknown id', async ({ request }) => {
    const res = await request.delete('/snapshots/nonexistent-id-xyz');
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test('DELETE /snapshots clears all queued snapshots', async ({ request }) => {
    // Create two snapshots
    await request.post('/snapshots', { data: VALID_SNAPSHOT });
    await request.post('/snapshots', {
      data: { ...VALID_SNAPSHOT, name: 'Second Snapshot' },
    });

    const clearRes = await request.delete('/snapshots');
    expect(clearRes.status()).toBe(200);
    const body = await clearRes.json();
    expect(body.message).toBe('Snapshots cleared');

    // Verify queue is empty
    const listRes = await request.get('/snapshots');
    const list = await listRes.json();
    expect(list.length).toBe(0);
  });
});
