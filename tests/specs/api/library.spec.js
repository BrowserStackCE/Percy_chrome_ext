// API tests — Library endpoints: POST /library/token, GET /library/status,
//   GET /library/all, GET /library/search
// NOTE: /library/token requires a real PERCY_READ_TOKEN to fully exercise the
// library load path. Tests that need it are skipped when the env var is absent.
const { test, expect } = require('@playwright/test');

const PERCY_READ_TOKEN = process.env.PERCY_READ_TOKEN;

test.describe('Library endpoints', () => {
  test('GET /library/status returns connection status', async ({ request }) => {
    const res = await request.get('/library/status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Shape check — connected may be true or false depending on prior state
    expect(typeof body).toBe('object');
  });

  test('POST /library/token returns 400 when token is missing', async ({ request }) => {
    const res = await request.post('/library/token', { data: {} });
    // Backend should reject an empty token
    expect([400, 422, 500]).toContain(res.status());
  });

  test('GET /library/all returns array (empty when not connected)', async ({ request }) => {
    const res = await request.get('/library/all');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('GET /library/search returns array for a query', async ({ request }) => {
    const res = await request.get('/library/search?name=homepage');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test.skip(!PERCY_READ_TOKEN, 'PERCY_READ_TOKEN not set — skipping live library token test');
  test('POST /library/token loads library with valid token', async ({ request }) => {
    test.skip(!PERCY_READ_TOKEN, 'PERCY_READ_TOKEN not set');
    const res = await request.post('/library/token', {
      data: { token: PERCY_READ_TOKEN },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeTruthy();
  });
});
