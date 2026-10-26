// Runner behaviour against a local fixture (file://), Percy stubbed over HTTP.
// Needs playwright + chromium (installed by the Go PlaywrightInstaller).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runWorkflow, EXIT } from '../src/run.js';
import { serveFixtures } from './serve.js';

let fixtures;
let startUrl;
before(async () => {
  fixtures = await serveFixtures();
  startUrl = `${fixtures.base}/dynamic.html`;
});
after(async () => {
  await fixtures.close();
});

async function percyStub(status = 200) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(status).end('{}');
    });
  });
  await new Promise((r) => server.listen(0, r));
  return { received, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Collect NDJSON events the runner writes to stdout.
async function capture(fn) {
  const events = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim().startsWith('{')) {
        try { events.push(JSON.parse(line)); } catch { /* not ours */ }
      }
    }
    return true;
  };
  try {
    return { result: await fn(), events };
  } finally {
    process.stdout.write = orig;
  }
}

function wf(steps, extra = {}) {
  return {
    version: 3,
    startUrl,
    steps,
    settings: { defaultTimeoutMs: 4000, viewport: { width: 900, height: 600 } },
    ...extra,
  };
}

const journey = [
  { id: 'step_001', type: 'fill', target: { role: 'textbox', name: 'Username' }, value: 'alice' },
  { id: 'step_002', type: 'fill', target: { role: 'textbox', name: 'Password' }, valueRef: 'pw' },
  { id: 'step_003', type: 'select', target: { css: '#plan' }, value: 'pro' },
  { id: 'step_004', type: 'check', target: { role: 'checkbox', name: 'I agree' } },
  { id: 'step_005', type: 'snapshot', checkpointId: 'before', name: 'Before' },
  { id: 'step_006', type: 'click', target: { role: 'button', name: 'Sign in' } },
  { id: 'step_007', type: 'waitFor', condition: 'visible', target: { role: 'heading', name: 'Dashboard' }, timeoutMs: 5000 },
  { id: 'step_008', type: 'snapshot', checkpointId: 'dashboard', name: 'Dashboard' },
  { id: 'step_009', type: 'scroll', scrollX: 0, scrollY: 50 },
  { id: 'step_010', type: 'snapshot', checkpointId: 'scrolled', name: 'Scrolled' },
];

test('replays a journey in order, waits for dynamic content, writes one DOM per checkpoint', async () => {
  const percy = await percyStub();
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const { result, events } = await capture(() =>
    runWorkflow({ buildId: 'build_t', artifactDir, percyUrl: percy.url, secrets: { pw: 'hunter2-SECRET' }, workflow: wf(journey) }),
  );
  percy.close();

  assert.equal(result, EXIT.PASSED);

  // steps ran strictly in recorded order
  const started = events.filter((e) => e.type === 'stepStarted').map((e) => e.stepId);
  assert.deepEqual(started, journey.map((s) => s.id));

  // one distinct DOM file per checkpoint
  const doms = (await readdir(path.join(artifactDir, 'dom'))).sort();
  assert.deepEqual(doms, ['before.html', 'dashboard.html', 'scrolled.html']);

  // the dashboard DOM is the LIVE state after the delayed render + form values
  const dash = await readFile(path.join(artifactDir, 'dom', 'dashboard.html'), 'utf8');
  assert.match(dash, /Dashboard/);
  // The page echoes the typed password into visible text. The other fields prove
  // the form really was filled; the secret itself must be scrubbed by value.
  assert.match(dash, /user=alice;pw=\[REDACTED\];agree=true;plan=pro/);
  assert.doesNotMatch(dash, /hunter2-SECRET/);
  assert.doesNotMatch(JSON.stringify(percy.received), /hunter2-SECRET/);
  const before = await readFile(path.join(artifactDir, 'dom', 'before.html'), 'utf8');
  assert.doesNotMatch(before, /<h2>Dashboard<\/h2>/);

  // Percy received the three checkpoints, by name, in order
  assert.deepEqual(percy.received.map((r) => r.name), ['Before', 'Dashboard', 'Scrolled']);

  // metadata names the build + workflow version
  const meta = JSON.parse(await readFile(path.join(artifactDir, 'metadata', 'dashboard.json'), 'utf8'));
  assert.equal(meta.buildId, 'build_t');
  assert.equal(meta.workflowVersion, 3);
  assert.deepEqual(meta.viewport, { width: 900, height: 600 });

  // the secret never appears in events (they go to Go's logs) or in metadata
  assert.doesNotMatch(JSON.stringify(events), /hunter2-SECRET/);
  assert.doesNotMatch(JSON.stringify(meta), /hunter2-SECRET/);
});

test('redactSecrets scrubs by value, longest first, and skips values too short to be safe', async () => {
  const { redactSecrets } = await import('../src/capture.js');
  const html = '<p>abcd1234</p><i>abcd</i><b>x</b><u>ab</u>';
  assert.equal(
    redactSecrets(html, { long: 'abcd1234', short: 'abcd', tiny: 'x', tiny2: 'ab', notString: 42 }),
    '<p>[REDACTED]</p><i>[REDACTED]</i><b>x</b><u>ab</u>',
  );
  assert.equal(redactSecrets(html, undefined), html);
  assert.equal(redactSecrets(html, {}), html);
});

test('password input value is redacted from the saved DOM artifact', async () => {
  const percy = await percyStub();
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir, percyUrl: percy.url, secrets: { pw: 'hunter2-SECRET' },
      workflow: wf([
        { id: 'step_001', type: 'fill', target: { css: '#pw' }, valueRef: 'pw' },
        { id: 'step_002', type: 'snapshot', checkpointId: 'filled', name: 'Filled' },
      ]),
    }),
  );
  percy.close();
  // fill() sets the property, not the attribute, so check both the file and what Percy was sent
  const saved = await readFile(path.join(artifactDir, 'dom', 'filled.html'), 'utf8');
  assert.doesNotMatch(saved, /hunter2-SECRET/);
  assert.doesNotMatch(JSON.stringify(percy.received), /hunter2-SECRET/);
});

test('run emits value-free log events for each step and the form state at snapshot', async () => {
  const percy = await percyStub();
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const { events } = await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir, percyUrl: percy.url, secrets: { pw: 'hunter2-SECRET' },
      workflow: wf([
        { id: 'step_001', type: 'fill', target: { css: '#user' }, value: 'alice' },
        { id: 'step_002', type: 'fill', target: { css: '#pw' }, valueRef: 'pw' },
        { id: 'step_003', type: 'snapshot', checkpointId: 'logged', name: 'Logged' },
      ]),
    }),
  );
  percy.close();
  const logs = events.filter((e) => e.type === 'log').map((e) => e.message);
  assert.ok(logs.some((m) => /step step_001: fill/.test(m)));
  const snap = logs.find((m) => /snapshot "Logged"/.test(m));
  assert.match(snap, /user\[text\] filled=true length=5/);
  assert.match(snap, /pw\[password\] filled=true length=14/);
  // values themselves never reach the log
  assert.doesNotMatch(JSON.stringify(events), /alice|hunter2-SECRET/);
});

test('snapshot DOM carries filled, selected and checked form state (not just attributes)', async () => {
  const percy = await percyStub();
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir, percyUrl: percy.url, secrets: { pw: 'hunter2-SECRET' },
      workflow: wf([
        { id: 'step_001', type: 'fill', target: { css: '#user' }, value: 'alice' },
        { id: 'step_002', type: 'fill', target: { css: '#pw' }, valueRef: 'pw' },
        { id: 'step_003', type: 'select', target: { css: '#plan' }, value: 'pro' },
        { id: 'step_004', type: 'check', target: { css: '#agree' } },
        { id: 'step_005', type: 'snapshot', checkpointId: 'form', name: 'Form' },
      ]),
    }),
  );
  percy.close();
  const saved = await readFile(path.join(artifactDir, 'dom', 'form.html'), 'utf8');
  assert.match(saved, /<input id="user" type="text" value="alice"/);
  assert.match(saved, /<input id="agree" type="checkbox" checked=""/);
  assert.match(saved, /<option value="pro" selected="">/);
  assert.doesNotMatch(saved, /<option value="free" selected/);
  // sensitive fields stay blank
  assert.doesNotMatch(saved, /hunter2-SECRET/);
  assert.doesNotMatch(saved, /<input id="pw" type="password" value=/);
  assert.match(JSON.stringify(percy.received), /value=\\"alice\\"/);
});

test('ambiguous locator fails safely at that step and keeps a debug DOM', async () => {
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const { result, events } = await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir,
      workflow: wf([
        { id: 'step_001', type: 'click', target: { role: 'button', name: 'Duplicate' } },
        { id: 'step_002', type: 'snapshot', checkpointId: 'never', name: 'Never' },
      ]),
    }),
  );
  assert.equal(result, EXIT.FAILED);
  const fin = events.find((e) => e.type === 'stepFinished' && e.stepId === 'step_001');
  assert.equal(fin.status, 'failed');
  assert.match(fin.message, /matched 2 elements/);
  assert.ok(!events.some((e) => e.type === 'stepStarted' && e.stepId === 'step_002'), 'must stop after the failure');
  assert.ok((await readdir(path.join(artifactDir, 'dom'))).includes('failure_step_001.html'));
});

test('missing element fails with the locator and tried strategies named', async () => {
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const { result, events } = await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir,
      workflow: wf([{ id: 'step_001', type: 'click', target: { role: 'button', name: 'Nope', fallbacks: [{ css: '#nope' }] }, timeoutMs: 600 }]),
    }),
  );
  assert.equal(result, EXIT.FAILED);
  const fin = events.find((e) => e.type === 'stepFinished');
  assert.match(fin.message, /role=button\[name="Nope"\]/);
  assert.match(fin.message, /css=#nope/);
});

test('a recorded fallback locator rescues a stale primary', async () => {
  const percy = await percyStub();
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const { result } = await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir, percyUrl: percy.url,
      workflow: wf([
        { id: 'step_001', type: 'click', target: { role: 'button', name: 'Old label', fallbacks: [{ css: '#signin' }] }, timeoutMs: 600 },
        { id: 'step_002', type: 'waitFor', condition: 'visible', target: { role: 'heading', name: 'Dashboard' }, timeoutMs: 4000 },
      ]),
    }),
  );
  percy.close();
  assert.equal(result, EXIT.PASSED);
});

test('missing secret fails the step without echoing any value', async () => {
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const { result, events } = await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir, secrets: {},
      workflow: wf([{ id: 'step_001', type: 'fill', target: { css: '#pw' }, valueRef: 'pw' }]),
    }),
  );
  assert.equal(result, EXIT.FAILED);
  assert.match(events.find((e) => e.type === 'stepFinished').message, /secret "pw" was not provided/);
});

test('percy upload failure keeps the DOM and yields PARTIAL', async () => {
  const percy = await percyStub(500);
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const { result, events } = await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir, percyUrl: percy.url,
      workflow: wf([{ id: 'step_001', type: 'snapshot', checkpointId: 'only', name: 'Only' }]),
    }),
  );
  percy.close();
  assert.equal(result, EXIT.PARTIAL);
  assert.ok(events.some((e) => e.type === 'checkpointUploadFailed' && e.checkpointId === 'only'));
  assert.ok((await readdir(path.join(artifactDir, 'dom'))).includes('only.html'));
});

test('invalid requests are rejected before a browser is launched', async () => {
  for (const bad of [
    { buildId: 'b', artifactDir: '/tmp/x', workflow: { startUrl: 'file:///etc/passwd', steps: [{ id: 's', type: 'snapshot', checkpointId: 'c', name: 'n' }] } },
    { buildId: 'b', artifactDir: '/tmp/x', workflow: { startUrl: 'https://a.test', steps: [{ id: 's', type: 'exec' }] } },
    { buildId: 'b', artifactDir: '/tmp/x', workflow: { startUrl: 'https://a.test', steps: [] } },
    { artifactDir: '/tmp/x', workflow: {} },
  ]) {
    const { result } = await capture(() => runWorkflow(bad));
    assert.equal(result, EXIT.INVALID);
  }
});

test('path-unsafe checkpoint ids cannot write outside the artifact dir', async () => {
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const { result } = await capture(() =>
    runWorkflow({
      buildId: 'build_t', artifactDir,
      workflow: wf([{ id: 'step_001', type: 'snapshot', checkpointId: '../../escape', name: 'Evil' }]),
    }),
  );
  assert.equal(result, EXIT.FAILED);
  assert.deepEqual((await readdir(path.dirname(artifactDir))).filter((n) => n === 'escape.html'), []);
});

test('snapshot waits waitMs before capture and forwards Percy options', async () => {
  const percy = await percyStub();
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const steps = [
    {
      id: 'step_001',
      type: 'snapshot',
      checkpointId: 'opts',
      name: 'Opts',
      waitMs: 1200,
      options: { widths: [375, 1280], minHeight: 800, scope: '#app', enableJavaScript: true, percyCSS: '.x{display:none}' },
    },
  ];
  const t0 = Date.now();
  const { result } = await capture(() =>
    runWorkflow({ buildId: 'build_o', artifactDir, percyUrl: percy.url, secrets: {}, workflow: wf(steps) }),
  );
  const elapsed = Date.now() - t0;
  percy.close();

  assert.equal(result, EXIT.PASSED);
  assert.ok(elapsed >= 1200, `expected the intentional wait, took ${elapsed}ms`);
  const body = percy.received[0];
  assert.deepEqual(body.widths, [375, 1280]);
  assert.equal(body.minHeight, 800);
  assert.equal(body.scope, '#app');
  assert.equal(body.enableJavaScript, true);
  assert.equal(body.percyCSS, '.x{display:none}');
});

test('legacy snapshot without waitMs/options keeps viewport widths and does not wait', async () => {
  const percy = await percyStub();
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const steps = [{ id: 'step_001', type: 'snapshot', checkpointId: 'legacy', name: 'Legacy' }];
  const t0 = Date.now();
  const { result } = await capture(() =>
    runWorkflow({ buildId: 'build_l', artifactDir, percyUrl: percy.url, secrets: {}, workflow: wf(steps) }),
  );
  const elapsed = Date.now() - t0;
  percy.close();

  assert.equal(result, EXIT.PASSED);
  assert.ok(elapsed < 1200, `legacy snapshot should not add a wait, took ${elapsed}ms`);
  const body = percy.received[0];
  assert.deepEqual(body.widths, [900]);
  assert.equal(body.minHeight, 600);
  assert.equal(body.scope, undefined);
  assert.equal(body.percyCSS, undefined);
});
