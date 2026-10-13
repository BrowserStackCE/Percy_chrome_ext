// E2E: workflow recorder with the REAL built extension (content script +
// service worker) loaded into Chromium, saving through the REAL Go backend.
//
// Local only: --load-extension is not supported on BrowserStack cloud.
//
// Requires:
//   - Go backend on http://localhost:4321
//   - Built extension: (cd percy-local-manager-extension && npm run build)
//
// Env: EXTENSION_DIST (default ../percy-local-manager-extension/dist)

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

const BACKEND = process.env.BACKEND_URL || 'http://localhost:4321';
const DIST = path.resolve(
  __dirname,
  process.env.EXTENSION_DIST || '../../../percy-local-manager-extension/dist'
);
const SITE = 'http://recorder-fixture.test';

const PAGE_HTML = `<!doctype html><html><head><title>Fixture</title></head><body>
  <h1>Login</h1>
  <form onsubmit="event.preventDefault(); document.getElementById('welcome').hidden=false;">
    <label for="user">Username</label><input id="user" name="user" type="text" />
    <label for="pw">Password</label><input id="pw" name="pw" type="password" />
    <label for="plan">Plan</label>
    <select id="plan" name="plan"><option value="free">Free</option><option value="pro">Pro</option></select>
    <label><input id="agree" type="checkbox" /> I agree</label>
    <button type="submit">Sign in</button>
  </form>
  <h2 id="welcome" hidden>Dashboard</h2>
</body></html>`;

// BROWSERSTACK_USERNAME is often set locally too, so only skip when the run is
// explicitly a BrowserStack cloud run (browserstack-node-sdk sets BROWSERSTACK_BUILD_NAME-like vars
// per session; use an explicit opt-in flag instead of guessing).
test.skip(process.env.BSTACK_CLOUD_RUN === '1', 'extension loading is not supported on BrowserStack cloud');
test.skip(!fs.existsSync(path.join(DIST, 'manifest.json')), 'build the extension first (npm run build)');

test.describe('Workflow recorder (real extension)', () => {
  let context;
  let page;
  let extensionId;
  let popup;

  test.beforeAll(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--headless=new'],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    extensionId = new URL(worker.url()).host;

    await context.route(`${SITE}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: PAGE_HTML })
    );
    page = await context.newPage();
    await page.goto(`${SITE}/login`);
  });

  test.afterAll(async () => {
    await context.close();
  });

  // Sends a recorder message and fails the test on a worker-reported error,
  // so a failed rec:start can never be silently swallowed.
  async function rec(message) {
    const res = await popup.evaluate((m) => chrome.runtime.sendMessage(m), message);
    expect(res?.error, `recorder message ${message.kind} failed`).toBeUndefined();
    return res;
  }

  async function openPopup() {
    // The popup normally targets the active tab; open it as a page but make
    // the fixture tab the active one afterwards.
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);
    await page.bringToFront();
    return popup;
  }

  test('records actions, a checkpoint, secrets as references, and saves via the backend', async () => {
    await openPopup();
    await expect(popup.locator('.connection-status--connected')).toBeVisible();

    // Start recording (background resolves the active tab = fixture page).
    await page.bringToFront();
    await rec({ kind: 'rec:start' });
    // content script is told recording is active asynchronously
    await page.waitForTimeout(300);

    await page.getByLabel('Username').fill('alice');
    await page.getByLabel('Password').fill('hunter2-SECRET');
    // A native <select> cannot be changed with trusted events in headless
    // Chromium (selectOption() dispatches untrusted events, which the recorder
    // deliberately ignores so page scripts cannot inject steps). The select
    // step is covered in recorder-core unit tests instead.
    await page.getByLabel('I agree').check();
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await rec({ kind: 'rec:snapshot', name: 'Dashboard' });
    await rec({ kind: 'rec:stop' });

    const state = await rec({ kind: 'rec:get' });
    const types = state.steps.map((s) => s.type);
    expect(types).toEqual(['fill', 'fill', 'check', 'click', 'snapshot']);

    // Ordered, unique step ids
    expect(state.steps.map((s) => s.id)).toEqual([
      'step_001', 'step_002', 'step_003', 'step_004', 'step_005',
    ]);

    // Password never stored as a literal
    const pw = state.steps[1];
    expect(pw.value).toBeUndefined();
    expect(pw.valueRef).toBeTruthy();
    expect(JSON.stringify(state)).not.toContain('hunter2-SECRET');

    // Plain text input keeps its literal value; locator prefers role+name over css
    expect(state.steps[0].value).toBe('alice');
    expect(state.steps[0].target.role).toBe('textbox');
    expect(state.steps[0].target.name).toBe('Username');
    expect(state.steps[0].target.fallbacks?.length).toBeGreaterThan(0);

    // Checkpoint
    expect(state.steps[4]).toMatchObject({ type: 'snapshot', checkpointId: 'dashboard', name: 'Dashboard' });
  });

  test('saved workflow round-trips through the Go API and survives a popup reload', async ({ request }) => {
    const state = await rec({ kind: 'rec:get' });
    expect(state.steps.length).toBeGreaterThan(0);

    // Save through the popup UI (real WorkflowPanel + workflowApi).
    await popup.reload();
    await popup.getByLabel('Workflow name').fill('Login journey');
    await popup.getByRole('button', { name: 'Save Workflow' }).click();
    await expect(popup.getByText('✓ Saved "Login journey"')).toBeVisible();

    const list = await (await request.get(`${BACKEND}/api/workflows`)).json();
    // Earlier runs may leave same-named workflows behind; take the newest one.
    const saved = list
      .filter((w) => w.name === 'Login journey')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    expect(saved).toBeTruthy();
    expect(saved.version).toBe(1);
    expect(saved.steps.some((s) => s.type === 'snapshot' && s.checkpointId === 'dashboard')).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('hunter2-SECRET');

    // "Retrieve after reloading the extension"
    await popup.reload();
    await expect(popup.locator(`option[value="${saved.workflowId}"]`)).toBeAttached();
  });

  test('Save is blocked until at least one snapshot checkpoint exists', async () => {
    await page.bringToFront();
    await rec({ kind: 'rec:start' });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await rec({ kind: 'rec:stop' });
    await popup.reload();
    await popup.getByLabel('Workflow name').fill('No checkpoint');
    await expect(popup.getByRole('button', { name: 'Save Workflow' })).toBeDisabled();
    await rec({ kind: 'rec:clear' });
  });
});
