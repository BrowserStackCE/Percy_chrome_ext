// M1 PoC: needs playwright + chromium installed in the runtime folder.
// Run via: node --test (from runtime/playwright/runner after extraction), or
// through the Go integration helper. Percy is stubbed with a local HTTP server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runWorkflow } from '../src/run.js';
import { serveFixtures } from './serve.js';

test('click, capture live DOM, post to percy', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200).end('{}');
    });
  });
  await new Promise((r) => server.listen(0, r));
  const percyUrl = `http://127.0.0.1:${server.address().port}`;
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  const fixtures = await serveFixtures();

  const code = await runWorkflow({
    buildId: 'build_test',
    artifactDir,
    percyUrl,
    workflow: {
      version: 1,
      startUrl: `${fixtures.base}/index.html`,
      steps: [
        { id: 's1', type: 'click', target: { css: '#go' } },
        { id: 's2', type: 'snapshot', checkpointId: 'after_click', name: 'After click' },
      ],
    },
  });
  server.close();
  await fixtures.close();

  assert.equal(code, 0);
  const dom = await readFile(path.join(artifactDir, 'dom', 'after_click.html'), 'utf8');
  assert.match(dom, /clicked/); // live state, not the original HTML
  assert.doesNotMatch(dom, /s3cret-do-not-persist/); // sensitive value redacted
  assert.equal(received.length, 1);
  assert.equal(received[0].url, '/percy/snapshot');
  assert.equal(received[0].body.name, 'After click');
  const meta = JSON.parse(await readFile(path.join(artifactDir, 'metadata', 'after_click.json'), 'utf8'));
  assert.equal(meta.buildId, 'build_test');
  assert.equal(meta.workflowVersion, 1);
});
