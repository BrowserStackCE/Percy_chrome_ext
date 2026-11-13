// E2E UI test — positive scenario: finalize a Percy build with a VALID token.
//
// Drives the real extension Snapshots page (served by the Vite dev server) against
// the REAL Go backend and Percy CLI — nothing is mocked:
//   1. queue a snapshot through the backend API
//   2. open snapshots.html with the real token saved
//   3. click "Finalize Build"
//   4. wait for "✓ Build finished" and the "Open Percy Build →" link
//
// Requires:
//   - Go backend running on BACKEND_URL (default http://localhost:4321)
//   - Vite dev server running on EXTENSION_DEV_URL (default http://localhost:5173)
//     (cd percy-local-manager-extension && npm run dev)
//   - PERCY_TOKEN (valid full-access token). Without it the test is skipped and a
//     "skip-reason" annotation is recorded in the report.
//
// The incorrect-token (negative) UI scenario lives in ui-extension.spec.js.

const { test, expect } = require('@playwright/test');
const { EXTENSION_DEV_URL, CHROME_RUNTIME_POLYFILL } = require('../../helpers/chromeRuntimePolyfill');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4321';
const PERCY_TOKEN = process.env.PERCY_TOKEN;
const SNAPSHOT_NAME = 'UI Real Finalize Snapshot';
const SNAPSHOT_NAMES = [SNAPSHOT_NAME, `${SNAPSHOT_NAME} 2`, `${SNAPSHOT_NAME} 3`];

test.describe('Finalize build — valid token (real backend, UI)', () => {
  test('finalizing a build with a valid token shows Build finished', async ({ browser, request }) => {
    test.setTimeout(240_000);

    if (!PERCY_TOKEN) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'PERCY_TOKEN not found — set the PERCY_TOKEN env var / repo secret to run the real finalize-build UI test',
      });
    }
    test.skip(!PERCY_TOKEN, 'PERCY_TOKEN not found — skipping real finalize build UI test');

    // The backend runs ONE build at a time (409 otherwise) and keeps one shared
    // snapshot queue, so start from a clean queue with no build in flight.
    await request.delete(`${BACKEND_URL}/snapshots`);
    await expect
      .poll(async () => (await (await request.get(`${BACKEND_URL}/build/status`)).json()).status, {
        timeout: 200_000,
        intervals: [1000],
      })
      .not.toBe('running');

    // Seed several snapshots through the real backend API
    for (const name of SNAPSHOT_NAMES) {
      const created = await request.post(`${BACKEND_URL}/snapshots`, {
        data: {
          name,
          url: 'https://example.com',
          dom: `<!DOCTYPE html><html><head><title>UI E2E</title></head><body><h1>${name}</h1></body></html>`,
          widths: [1280],
          minHeight: 600,
        },
      });
      expect(created.status()).toBe(201);
    }

    // Confirm the queue really holds the seeded snapshots before opening the UI
    await expect
      .poll(async () => (await (await request.get(`${BACKEND_URL}/snapshots`)).json()).map((s) => s.name), {
        timeout: 10_000,
      })
      .toEqual(expect.arrayContaining(SNAPSHOT_NAMES));

    const page = await browser.newPage();
    try {
      await page.addInitScript(CHROME_RUNTIME_POLYFILL);
      // Save the real token the way the extension does (key: percyToken, see tokenStorage.ts)
      await page.addInitScript((token) => {
        window.chrome.storage.local.set({ percyToken: token });
      }, PERCY_TOKEN);

      await page.goto(`${EXTENSION_DEV_URL}/snapshots.html`);
      // Scope to the queue table: the build progress card repeats snapshot names
      const queueTable = page.locator('.snapshot-table');
      const firstRow = queueTable.getByText(SNAPSHOT_NAME, { exact: true });
      // Reload once if the page rendered before the queue was readable
      if (!(await firstRow.isVisible({ timeout: 5_000 }).catch(() => false))) {
        await page.reload();
      }
      for (const name of SNAPSHOT_NAMES) {
        await expect(queueTable.getByText(name, { exact: true })).toBeVisible();
      }

      const finalizeBtn = page.getByRole('button', { name: 'Finalize Build' });
      await expect(finalizeBtn).toBeEnabled();
      await finalizeBtn.click();

      // Percy CLI install + upload + processing can take a couple of minutes
      await expect(page.getByText('✓ Build finished')).toBeVisible({ timeout: 200_000 });
      await expect(page.getByRole('button', { name: 'Open Percy Build →' })).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: 'Build failed' })).toHaveCount(0);
    } finally {
      await page.close();
      await request.delete(`${BACKEND_URL}/snapshots`);
    }
  });
});
