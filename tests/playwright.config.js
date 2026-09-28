// @ts-check
const { defineConfig } = require('@playwright/test');
require('dotenv').config({ path: __dirname + '/.env' });

// On BrowserStack cloud, network round-trips are slower — use a longer timeout.
const isBrowserStack = !!process.env.BROWSERSTACK_USERNAME;

module.exports = defineConfig({
  testDir: './specs',
  // 60s on BrowserStack cloud, 30s locally
  timeout: isBrowserStack ? 60_000 : 30_000,
  // Always retry twice on BrowserStack (flaky network); once locally in CI
  retries: isBrowserStack ? 2 : (process.env.CI ? 1 : 0),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BACKEND_URL || 'http://localhost:4321',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
    // Give each action more time on cloud
    actionTimeout: isBrowserStack ? 15_000 : 5_000,
    navigationTimeout: isBrowserStack ? 30_000 : 10_000,
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
