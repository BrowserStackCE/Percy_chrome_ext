// E2E: record -> edit step -> save -> replay, driven through the REAL extension
// popup UI against the REAL Go backend, Playwright runner and Percy CLI.
//
// Local only (extension loading is unsupported on BrowserStack cloud).
//
// Requires:
//   - Go backend on http://localhost:4321 (node + npm available for first-run installs)
//   - Port 5338 free (the backend starts Percy CLI itself)
//   - Built extension: (cd percy-local-manager-extension && npm run build)
//   - PERCY_TOKEN in tests/.env (loaded by playwright.config.js). Never logged.

const { test, expect, chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const BACKEND = process.env.BACKEND_URL || 'http://localhost:4321';
const DIST = path.resolve(
  __dirname,
  process.env.EXTENSION_DIST || '../../../percy-local-manager-extension/dist'
);

// Two checkpoints with a delayed render in between, served from a real origin.
const PAGE_HTML = `<!doctype html><html><head><title>Replay fixture</title></head><body>
  <h1>Sign in</h1>
  <label for="user">Username</label><input id="user" name="user" type="text" />
  <label for="pw">Password</label><input id="pw" name="pw" type="password" />
  <button id="go" type="button">Log in</button>
  <h2 id="dash" hidden>Welcome back</h2>
  <script>
    document.getElementById('go').addEventListener('click', function () {
      setTimeout(function () { document.getElementById('dash').hidden = false; }, 500);
    });
  </script>
</body></html>`;

test.skip(process.env.BSTACK_CLOUD_RUN === '1', 'extension loading is not supported on BrowserStack cloud');
test.skip(!fs.existsSync(path.join(DIST, 'manifest.json')), 'build the extension first (npm run build)');
test.skip(!process.env.PERCY_TOKEN, 'PERCY_TOKEN is not set in tests/.env');

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000); // first run may install Playwright/Percy and download Chromium

test.describe('Workflow replay (real extension, runner and Percy)', () => {
  let server;
  let siteUrl;
  let context;
  let page;
  let popup;
  let extensionId;
  const workflowName = `Replay e2e ${Date.now()}`;

  async function rec(message) {
    const res = await popup.evaluate((m) => chrome.runtime.sendMessage(m), message);
    expect(res?.error, `recorder message ${message.kind} failed`).toBeUndefined();
    return res;
  }

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE_HTML);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    siteUrl = `http://127.0.0.1:${server.address().port}/`;

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--headless=new'],
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    extensionId = new URL(worker.url()).host;

    page = await context.newPage();
    await page.goto(siteUrl);
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/index.html`);

    // Seed the saved project token the same way the Settings panel does
    // (key: percyToken). Done inside the page so the value never reaches logs.
    const token = process.env.PERCY_TOKEN;
    await popup.evaluate((t) => chrome.storage.local.set({ percyToken: t }), token);
    await popup.reload();
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise((r) => server?.close(r));
  });

  test('records two checkpoints, edits a step through the UI, and saves', async () => {
    await expect(popup.locator('.connection-status--connected')).toBeVisible();

    await page.bringToFront();
    await rec({ kind: 'rec:start' });
    await page.waitForTimeout(300);

    await page.getByLabel('Username').fill('alice');
    await page.getByLabel('Password').fill('hunter2-SECRET');
    await rec({ kind: 'rec:snapshot', name: 'Login form' });
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await rec({ kind: 'rec:snapshot', name: 'Welcome page' });
    await rec({ kind: 'rec:stop' });

    await popup.reload();

    // --- Edit Step UI: change the label of the click step ---
    const clickRow = popup.getByRole('listitem').filter({ hasText: 'Click' });
    await clickRow.getByRole('button', { name: /Edit step/ }).click();
    await popup.getByLabel('Label').fill('Submit the login form');
    await popup.getByRole('button', { name: 'Save step' }).click();
    await expect(popup.getByText('Submit the login form')).toBeVisible();

    // --- Save through the UI ---
    await popup.getByLabel('Workflow name').fill(workflowName);
    await popup.getByRole('button', { name: 'Save Workflow' }).click();
    await expect(popup.getByText(`✓ Saved "${workflowName}"`)).toBeVisible();
  });

  test('saved workflow keeps the edited label and no literal secret', async ({ request }) => {
    const list = await (await request.get(`${BACKEND}/api/workflows`)).json();
    const saved = list.find((w) => w.name === workflowName);
    expect(saved, 'workflow should be saved').toBeTruthy();
    expect(saved.steps.some((s) => s.label === 'Submit the login form')).toBe(true);
    expect(saved.steps.filter((s) => s.type === 'snapshot').map((s) => s.checkpointId)).toEqual([
      'login_form',
      'welcome_page',
    ]);
    expect(JSON.stringify(saved)).not.toContain('hunter2-SECRET');
    expect(saved.steps.find((s) => s.valueRef)).toBeTruthy();
  });

  test('Replay / Create Build runs the journey and shows progress to a passed build', async ({ request }) => {
    await popup.reload();

    // Guard against a runaway polling loop: the popup should poll a build about
    // every 1.5s, never hundreds of times per second.
    let buildPolls = 0;
    popup.on('request', (req) => {
      if (/\/api\/builds\/build_[^/]+$/.test(new URL(req.url()).pathname)) buildPolls++;
    });
    const polledFrom = Date.now();

    // The workflow expects one secret at replay time; it is entered per run and never saved.
    const replayBtn = popup.getByRole('button', { name: 'Replay / Create Build' });
    await expect(replayBtn).toBeDisabled(); // blocked until the secret is provided
    await popup.getByLabel('Password', { exact: false }).fill('hunter2-SECRET');
    await expect(replayBtn).toBeEnabled();
    await replayBtn.click();

    const progress = popup.getByRole('region', { name: 'Run progress' });
    await expect(progress).toBeVisible();
    await expect(progress.getByText(workflowName)).toBeVisible();

    // wait for a terminal state shown in the UI
    await expect(progress.getByRole('status')).toContainText(/Passed|Failed|Partially completed/, {
      timeout: 180_000,
    });
    await expect(progress.getByRole('status')).toContainText('Passed');
    await expect(progress.getByRole('list', { name: 'Checkpoints' })).toContainText('uploaded');

    // The backend agrees, and artifacts exist for BOTH checkpoints.
    const builds = await (await request.get(`${BACKEND}/api/builds`)).json();
    const mine = builds.find((b) => b.workflowName === workflowName);
    expect(mine.status).toBe('passed');
    expect(mine.workflowVersion).toBe(1);
    expect(mine.checkpoints.map((c) => c.checkpointId)).toEqual(['login_form', 'welcome_page']);

    const arts = await (await request.get(`${BACKEND}/api/builds/${mine.buildId}/artifacts`)).json();
    const names = arts.map((a) => `${a.kind}/${a.name}`);
    expect(names).toEqual(
      expect.arrayContaining(['dom/login_form.html', 'dom/welcome_page.html', 'logs/runner.log'])
    );

    // DOM is served as inert text and the typed secret is not in it
    const dom = await request.get(`${BACKEND}/api/builds/${mine.buildId}/artifacts/dom/welcome_page.html`);
    expect(dom.headers()['content-type']).toContain('text/plain');
    const body = await dom.text();
    expect(body).toContain('Welcome back');
    expect(body).not.toContain('hunter2-SECRET');

    // ~1 poll per 1.5s plus a few extras for resume/finish; a loop would be thousands
    const seconds = Math.max(1, (Date.now() - polledFrom) / 1000);
    expect(buildPolls, `${buildPolls} build polls in ${seconds.toFixed(1)}s`).toBeLessThanOrEqual(
      Math.ceil(seconds / 1.0) + 5
    );

    // History lists the build after the run
    await progress.getByRole('button', { name: 'Close' }).click();
    await expect(popup.getByRole('list', { name: 'Build history' })).toContainText(workflowName);
  });

  test('a build started earlier is still listed after a second request (prior builds remain)', async ({ request }) => {
    const builds = await (await request.get(`${BACKEND}/api/builds`)).json();
    expect(builds.filter((b) => b.workflowName === workflowName).length).toBe(1);
    expect(builds.length).toBeGreaterThanOrEqual(1);
  });
});
