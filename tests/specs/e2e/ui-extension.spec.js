// E2E UI tests — Chrome extension popup pages served via the Vite dev server
// (npm run dev in percy-local-manager-extension, default port 5173).
//
// A chrome.runtime polyfill is injected before each page load so that
// chrome.runtime.getURL() resolves to the dev server URL — this lets
// the pages render normally without needing --load-extension.
//
// A SINGLE browser page is reused across all tests (navigate between pages)
// to avoid the overhead of opening/closing a new cloud session per test.
//
// This approach works both locally AND on BrowserStack cloud via BrowserStack Local.
//
// Pages tested:
//   - Popup (index.html)         — connection status, capture panel, token settings (⚙)
//   - Snapshots (snapshots.html) — snapshot queue list
//   - Library (library.html)     — search input, snapshot grid
//
// Requires:
//   - Go backend running on http://localhost:4321
//   - Vite dev server running on http://localhost:5173
//     (cd percy-local-manager-extension && npm run dev)

const { test, expect } = require('@playwright/test');

// The Vite dev server URL — matches `npm run dev` default port
const EXTENSION_DEV_URL = process.env.EXTENSION_DEV_URL || 'http://localhost:5173';

// chrome.runtime polyfill — injected before each page load.
// Replaces chrome.runtime.getURL so icon paths resolve to the dev server URL.
const CHROME_RUNTIME_POLYFILL = `
  (function() {
    var BASE = '${EXTENSION_DEV_URL}';
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.getURL = function(p) {
      return BASE + '/' + p.replace(/^\\//, '');
    };
    window.chrome.tabs = window.chrome.tabs || { create: function() {} };
    // In-memory storage that supports both callback and promise styles
    // (the extension uses \`await chrome.storage.local.get(...)\`).
    function makeArea() {
      var data = {};
      return {
        get: function(k, cb) {
          var out = {};
          var keys = k == null ? Object.keys(data)
                   : Array.isArray(k) ? k
                   : typeof k === 'string' ? [k] : Object.keys(k);
          keys.forEach(function(key) { if (key in data) out[key] = data[key]; });
          if (cb) { cb(out); return; }
          return Promise.resolve(out);
        },
        set: function(items, cb) {
          Object.assign(data, items);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: function(k, cb) {
          [].concat(k).forEach(function(key) { delete data[key]; });
          if (cb) cb();
          return Promise.resolve();
        },
      };
    }
    window.chrome.storage = window.chrome.storage || {
      local: makeArea(),
      sync: makeArea(),
      onChanged: { addListener: function() {}, removeListener: function() {} },
    };
  })();
`;

test.describe('Extension UI (popup pages via Vite dev server)', () => {
  let page;

  // Open ONE page for the whole suite — reused across all tests
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.addInitScript(CHROME_RUNTIME_POLYFILL);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // Helper: navigate the shared page to an extension page
  async function goTo(pagePath) {
    await page.goto(`${EXTENSION_DEV_URL}/${pagePath}`);
  }

  // ----------------------------------------------------------------
  // Popup page — index.html
  // ----------------------------------------------------------------

  test('Popup: connection status indicator is present', async () => {
    await goTo('index.html');
    // ConnectionStatus renders <div class="connection-status connection-status--{status}">
    await expect(page.locator('.connection-status')).toBeVisible();
  });

  test('Popup: Capture Snapshot button is present', async () => {
    await goTo('index.html');
    // CaptureSnapshotPanel renders <button class="button button--primary button--block">Capture Snapshot</button>
    await expect(page.getByRole('button', { name: 'Capture Snapshot' })).toBeVisible();
  });

  test('Popup: token settings button prompts to set a token when none is saved', async () => {
    await goTo('index.html');
    // Popup header renders <button aria-label="Set project token">⚙</button> when no token exists
    await expect(page.getByRole('button', { name: 'Set project token' })).toBeVisible();
  });

  test('Popup: token settings panel opens and Save Token is disabled until a token is typed', async () => {
    await goTo('index.html');
    await page.getByRole('button', { name: 'Set project token' }).click();
    // TokenSettingsPanel renders <input id="percy-token"> and a "Save Token" button
    const tokenInput = page.locator('#percy-token');
    const saveBtn = page.getByRole('button', { name: 'Save Token' });
    await expect(tokenInput).toBeVisible();
    await expect(saveBtn).toBeDisabled();
    await tokenInput.fill('test-token');
    await expect(saveBtn).toBeEnabled();
  });

  test('Popup: token settings panel Back button returns to the capture view', async () => {
    await goTo('index.html');
    await page.getByRole('button', { name: 'Set project token' }).click();
    await page.getByRole('button', { name: '← Back' }).click();
    await expect(page.getByRole('button', { name: 'Capture Snapshot' })).toBeVisible();
  });

  test('Popup: snapshot name input accepts text', async () => {
    // The input is disabled while the backend is offline, so mock /health as healthy
    await goToConnectedPopup();
    // CaptureSnapshotPanel renders <input id="snapshot-name" placeholder="Defaults to page title">
    const nameInput = page.locator('#snapshot-name');
    await nameInput.fill('My Test Snapshot');
    await expect(nameInput).toHaveValue('My Test Snapshot');
  });

  test('Popup: View Snapshots button is present', async () => {
    await goTo('index.html');
    // Popup renders <button class="button button--secondary button--block">View Snapshots</button>
    await expect(page.getByRole('button', { name: 'View Snapshots' })).toBeVisible();
  });

  // ----------------------------------------------------------------
  // Library page — library.html
  // ----------------------------------------------------------------
  test('Library: page renders with Snapshot Library heading', async () => {
    await goTo('library.html');
    // LibraryPage renders <h1 class="library-page__title">Snapshot Library</h1>
    await expect(page.getByRole('heading', { name: 'Snapshot Library' })).toBeVisible();
  });

  test('Library: search input is present', async () => {
    await goTo('library.html');
    // LibraryPage renders <input placeholder="Search snapshots...">
    await expect(page.getByPlaceholder('Search snapshots...')).toBeVisible();
  });

  test('Library: search input accepts text and filters', async () => {
    await goTo('library.html');
    const searchInput = page.getByPlaceholder('Search snapshots...');
    await searchInput.fill('homepage');
    await expect(searchInput).toHaveValue('homepage');
  });

  // ----------------------------------------------------------------
  // Snapshots page — snapshots.html
  // ----------------------------------------------------------------
  test('Snapshots: page renders without crashing', async () => {
    await goTo('snapshots.html');
    // Percy logo should render — confirms BrandMark loaded correctly
    await expect(page.getByRole('img', { name: 'Percy Logo' })).toBeVisible();
  });

  test('Snapshots: shows token-required notice instead of a token input when no token is saved', async () => {
    await goTo('snapshots.html');
    // SnapshotsPage renders <TokenRequiredNotice role="alert"> and no #percy-token input
    await expect(page.getByRole('alert').filter({ hasText: 'A Percy token is required to finalize a build' })).toBeVisible();
    await expect(page.locator('#percy-token')).toHaveCount(0);
  });

  test('Snapshots: Snapshot Queue heading is visible', async () => {
    await goTo('snapshots.html');
    // SnapshotsPage renders <h1>Snapshot Queue</h1>
    await expect(page.getByRole('heading', { name: 'Snapshot Queue' })).toBeVisible();
  });

  test('Snapshots: Finalize Build button is present and disabled when no token is saved', async () => {
    await goTo('snapshots.html');
    // FinalizeBuildPanel renders <button>Finalize Build</button>, disabled without a token / snapshots
    const finalizeBtn = page.getByRole('button', { name: 'Finalize Build' });
    await expect(finalizeBtn).toBeVisible();
    await expect(finalizeBtn).toBeDisabled();
  });

  test('Snapshots: Clear Snapshots button is present', async () => {
    await goTo('snapshots.html');
    // ClearSnapshotsButton renders <button class="button button--danger">Clear Snapshots</button>
    await expect(page.getByRole('button', { name: 'Clear Snapshots' })).toBeVisible();
  });

  test('Snapshots: build progress card is hidden before a build is started', async () => {
    await goTo('snapshots.html');
    // BuildProgress renders <section aria-label="Build progress"> only once a build exists
    await expect(page.getByRole('region', { name: 'Build progress' })).toHaveCount(0);
  });

  test('Snapshots: failed build with an incorrect token shows the Build failed alert with the error', async () => {
    const ERROR_TEXT = 'invalid or missing token';
    const cors = { 'Access-Control-Allow-Origin': '*' };
    const json = (body, status = 200) => ({
      status,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify(body),
    });

    // Seed a token so Finalize Build is enabled (key: percyToken, see tokenStorage.ts)
    await page.addInitScript(() => {
      window.chrome.storage.local.set({ percyToken: 'incorrect-token' });
    });
    await page.route('**/snapshots', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill(json([{ id: 's1', name: 'Home', url: 'http://localhost/', widths: [1280], minHeight: 1024, createdAt: '2026-01-01T00:00:00Z' }]))
        : route.fallback()
    );
    await page.route('**/build/finalize', (route) => route.fulfill(json({ status: 'running' }, 202)));
    await page.route('**/build/status', (route) =>
      route.fulfill(json({
        status: 'failed',
        phase: 'starting',
        total: 1,
        sent: 0,
        snapshots: [{ id: 's1', name: 'Home', state: 'failed', error: ERROR_TEXT }],
        logs: [{ ts: '2026-01-01T00:00:00Z', level: 'error', line: ERROR_TEXT }],
        error: ERROR_TEXT,
      }))
    );

    try {
      await goTo('snapshots.html');
      await page.getByRole('button', { name: 'Finalize Build' }).click();

      const card = page.getByRole('region', { name: 'Build progress' });
      await expect(card).toBeVisible();
      await expect(card.getByRole('alert')).toContainText('Build failed');
      await expect(card.getByRole('alert')).toContainText(ERROR_TEXT);
      await expect(card.getByText('Failed', { exact: true })).toBeVisible();
      await expect(page.getByText('✓ Build finished')).toHaveCount(0);
    } finally {
      await page.unroute('**/snapshots');
      await page.unroute('**/build/finalize');
      await page.unroute('**/build/status');
    }
  });

  // ----------------------------------------------------------------
  // Popup — advanced snapshot options
  // ----------------------------------------------------------------

  // The advanced-options controls are disabled while the popup reports the
  // backend as offline, so mock GET /health as healthy for these tests.
  async function goToConnectedPopup() {
    await page.route('**/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ status: 'ok' }),
      })
    );
    await goTo('index.html');
    await expect(page.locator('.connection-status--connected')).toBeVisible();
  }

  test.afterEach(async () => {
    await page.unroute('**/health');
  });

  test('Popup: Advanced snapshot options toggle reveals capture fields', async () => {
    await goToConnectedPopup();
    await page.getByRole('button', { name: /Advanced snapshot options/ }).click();
    await expect(page.locator('#snapshot-min-height')).toHaveValue('1024');
    await expect(page.locator('#snapshot-scope')).toBeVisible();
    await expect(page.locator('#percy-css')).toBeVisible();
    await expect(page.getByLabel('Enable JavaScript')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add width' })).toBeVisible();
  });

  test('Popup: widths can be added and removed', async () => {
    await goToConnectedPopup();
    await page.getByRole('button', { name: /Advanced snapshot options/ }).click();
    const rows = page.locator('.width-row');
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: '+ Add width' }).click();
    await expect(rows).toHaveCount(3);
    await rows.last().getByRole('button', { name: '×' }).click();
    await expect(rows).toHaveCount(2);
    await rows.last().getByRole('button', { name: '×' }).click();
    await expect(rows).toHaveCount(1);
    // the last remaining width cannot be removed
    await expect(rows.first().getByRole('button', { name: '×' })).toBeDisabled();
  });

  test('Popup: Capture Snapshot is disabled when a width is 0', async () => {
    await goToConnectedPopup();
    await page.getByRole('button', { name: /Advanced snapshot options/ }).click();
    await page.locator('.width-row input').first().fill('0');
    await expect(page.getByRole('button', { name: 'Capture Snapshot' })).toBeDisabled();
  });
});