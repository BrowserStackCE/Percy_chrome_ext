// @ts-check
const { defineConfig } = require('@playwright/test');
require('dotenv').config({ path: __dirname + '/.env' });

module.exports = defineConfig({
  testDir: './specs',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
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
