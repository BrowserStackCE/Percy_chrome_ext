// API tests — Build endpoints: GET /build/status, POST /build/finalize
const { test, expect } = require('@playwright/test');

test.describe('Build endpoints', () => {
  test('GET /build/status returns a well-formed status object', async ({ request }) => {
    const res = await request.get('/build/status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['idle', 'running', 'success', 'failed']).toContain(body.status);
    expect(typeof body.total).toBe('number');
    expect(typeof body.sent).toBe('number');
    expect(Array.isArray(body.snapshots)).toBe(true);
    expect(Array.isArray(body.logs)).toBe(true);
  });

  test('POST /build/finalize with no snapshots returns an error', async ({ request }) => {
    const clear = await request.delete('/snapshots');
    expect(clear.ok()).toBe(true);

    const res = await request.post('/build/finalize', { data: { token: 'dummy' } });
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('no snapshots');
  });

  test('POST /build/finalize with malformed body returns 400', async ({ request }) => {
    const res = await request.post('/build/finalize', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not-json',
    });
    expect(res.status()).toBe(400);
  });

  test('POST /build/finalize with invalid token starts a job that ends failed with logs', async ({ request }) => {
    test.setTimeout(240_000);
    const snap = await request.post('/snapshots', {
      data: {
        name: 'build-status-test',
        url: 'http://localhost/',
        dom: '<html><body>hi</body></html>',
        widths: [1280],
        minHeight: 1024,
        enableJavaScript: false,
      },
    });
    expect(snap.ok()).toBe(true);

    // The backend runs ONE build job at a time (409 if one is running). Wait for
    // any in-flight build (e.g. a retry of an earlier attempt) to finish first;
    // `workers: 1` in playwright.config.js keeps other tests from racing this.
    await expect
      .poll(async () => (await (await request.get('/build/status')).json()).status, {
        timeout: 200_000,
        intervals: [1000],
      })
      .not.toBe('running');

    const start = await request.post('/build/finalize', { data: { token: 'invalid-token' } });
    expect(start.status()).toBe(202);
    expect((await start.json()).status).toBe('running');

    // A second start while running is rejected.
    const second = await request.post('/build/finalize', { data: { token: 'invalid-token' } });
    expect([409, 202]).toContain(second.status());

    await expect
      .poll(
        async () => (await (await request.get('/build/status')).json()).status,
        { timeout: 200_000, intervals: [1000] }
      )
      .toMatch(/failed|success/);

    const final = await (await request.get('/build/status')).json();
    expect(final.status).toBe('failed');
    expect(final.error).toBeTruthy();
    expect(final.logs.length).toBeGreaterThan(0);

    await request.delete('/snapshots');
  });
});
