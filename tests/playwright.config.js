// @ts-check
const { defineConfig } = require('@playwright/test');
require('dotenv').config({ path: __dirname + '/.env' });

// On BrowserStack cloud, network round-trips are slower — use a longer timeout.
// Extension UI tests require --load-extension which is not supported on cloud.
const isBrowserStack = !!process.env.BROWSERSTACK_USERNAME;

module.exports = defineConfig({
  testDir: './specs',
  // 3 minutes on BrowserStack or CI with PERCY_TOKEN (Percy CLI startup can take 90s+), 30s locally
  timeout: (isBrowserStack || process.env.CI) ? 180_000 : 30_000,
  // Always retry twice on BrowserStack (flaky network); once locally in CI
  retries: isBrowserStack ? 2 : (process.env.CI ? 1 : 0),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BACKEND_URL || 'http://localhost:4321',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
  projects: [
    {
      name: 'api',
      testMatch: '**/api/**/*.spec.js',
    },
    {
      name: 'e2e',
      testMatch: ['**/e2e/snapshot-lifecycle.spec.js'],
      use: { browserName: 'chromium' },
    },
    {
      name: 'extension-ui',
      testMatch: ['**/e2e/ui-extension.spec.js'],
      // Extension tests launch their own browser via chromium.launchPersistentContext
      // so no browser is configured here — the test manages its own context.
    },
  ],
});
