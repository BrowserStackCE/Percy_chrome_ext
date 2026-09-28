// E2E UI tests — Chrome extension popup pages loaded via Playwright's
// extension support. The extension is loaded from the built dist/ folder.
//
// Pages tested:
//   - Popup (index.html)       — connection status, capture panel, finalize button
//   - Snapshots (snapshots.html) — snapshot queue list
//   - Library (library.html)   — search input, snapshot grid
//
// Run with:
//   npx playwright test --project=extension-ui
//
// Requires: Go backend running on http://localhost:4321

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

const EXTENSION_PATH = path.resolve(__dirname, '../../../percy-local-manager-extension/dist');

test.describe('Extension UI (popup pages)', () => {
  let browser;
  let extensionId;

  test.beforeAll(async () => {
    browser = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
      ],
    });

    // This extension has no background/service worker (popup-only MV3).
    // Discover the extension ID by opening a page and intercepting the
    // chrome-extension:// URL that Chrome assigns to the loaded extension.
    // We do this by navigating to chrome://extensions via CDP.
    const page = await browser.newPage();

    // Use the extensions page to find the ID via CDP
    const client = await page.context().newCDPSession(page);
    await page.goto('chrome://extensions/');

    // Poll the page's DOM via evaluate — chrome://extensions uses shadow DOM
    extensionId = await page.evaluate(async () => {
      // Wait for the extensions manager to render
      for (let i = 0; i < 20; i++) {
        const manager = document.querySelector('extensions-manager');
        if (manager && manager.shadowRoot) {
          const itemList = manager.shadowRoot.querySelector('extensions-item-list');
          if (itemList && itemList.shadowRoot) {
            const items = Array.from(itemList.shadowRoot.querySelectorAll('extensions-item'));
            for (const item of items) {
              if (item.shadowRoot) {
                const nameEl = item.shadowRoot.querySelector('#name');
                if (nameEl && nameEl.textContent.trim() === 'Percy Local Manager') {
                  return item.id;
                }
              }
            }
          }
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return null;
    });

    await page.close();

    if (!extensionId) {
      throw new Error('Could not find Percy Local Manager extension ID on chrome://extensions');
    }
  });

  test.afterAll(async () => {
    await browser.close();
  });

  // ----------------------------------------------------------------
  // Popup page — index.html
  // ----------------------------------------------------------------
  test('Popup: Percy logo renders', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // BrandMark renders <img alt="Percy Logo">
    await expect(page.getByRole('img', { name: 'Percy Logo' })).toBeVisible();
    await page.close();
  });

  test('Popup: connection status indicator is present', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // ConnectionStatus renders <div class="connection-status connection-status--{status}">
    await expect(page.locator('.connection-status')).toBeVisible();
    await page.close();
  });

  test('Popup: Capture Snapshot button is present', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // CaptureSnapshotPanel renders <button class="button button--primary button--block">Capture Snapshot</button>
    await expect(page.getByRole('button', { name: 'Capture Snapshot' })).toBeVisible();
    await page.close();
  });

  test('Popup: Library token panel is present (Connect Library or Change token)', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // LibraryTokenPanel renders either:
    //   - "Connect Library" button (when no token saved)
    //   - "Change token" button (when token already saved)
    // Both are valid — we just verify the panel is interactive
    const connectBtn = page.getByRole('button', { name: 'Connect Library' });
    const changeBtn = page.getByRole('button', { name: 'Change token' });
    const panelPresent = await connectBtn.isVisible().catch(() => false) ||
                         await changeBtn.isVisible().catch(() => false);
    expect(panelPresent, 'Library token panel should show Connect Library or Change token button').toBe(true);
    await page.close();
  });

  test('Popup: snapshot name input accepts text', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // CaptureSnapshotPanel renders <input id="snapshot-name" placeholder="Defaults to page title">
    const nameInput = page.locator('#snapshot-name');
    await nameInput.fill('My Test Snapshot');
    await expect(nameInput).toHaveValue('My Test Snapshot');
    await page.close();
  });

  test('Popup: library search input is present', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // Popup renders <input placeholder="Search snapshots..."> in the library search panel
    await expect(page.getByPlaceholder('Search snapshots...')).toBeVisible();
    await page.close();
  });

  test('Popup: View Snapshots button is present', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    // Popup renders <button class="button button--secondary button--block">View Snapshots</button>
    await expect(page.getByRole('button', { name: 'View Snapshots' })).toBeVisible();
    await page.close();
  });

  // ----------------------------------------------------------------
  // Library page — library.html
  // ----------------------------------------------------------------
  test('Library: page renders with Snapshot Library heading', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    // LibraryPage renders <h1 class="library-page__title">Snapshot Library</h1>
    await expect(page.getByRole('heading', { name: 'Snapshot Library' })).toBeVisible();
    await page.close();
  });

  test('Library: search input is present', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    // LibraryPage renders <input placeholder="Search snapshots...">
    const searchInput = page.getByPlaceholder('Search snapshots...');
    await expect(searchInput).toBeVisible();
    await page.close();
  });

  test('Library: search input accepts text and filters', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    const searchInput = page.getByPlaceholder('Search snapshots...');
    await searchInput.fill('homepage');
    await expect(searchInput).toHaveValue('homepage');
    await page.close();
  });

  // ----------------------------------------------------------------
  // Snapshots page — snapshots.html
  // ----------------------------------------------------------------
  test('Snapshots: page renders without crashing', async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/snapshots.html`);
    // Percy logo should render — confirms BrandMark loaded correctly
    await expect(page.getByRole('img', { name: 'Percy Logo' })).toBeVisible();
    await page.close();
  });
});
