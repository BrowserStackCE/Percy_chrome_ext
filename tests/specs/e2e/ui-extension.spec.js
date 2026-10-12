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
    await goTo('index.html');
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
});