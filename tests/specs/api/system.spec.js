// API tests — System endpoints: GET /health, GET /status
const { test, expect } = require('@playwright/test');

test.describe('System endpoints', () => {
  test('GET /health returns status ready', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });

  test('GET /status returns running true and version', async ({ request }) => {
    const res = await request.get('/status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.running).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
  });
});
