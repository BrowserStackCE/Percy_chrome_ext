// Unit tests for the pure recorder helpers. Uses node:test (no new dependency)
// and the project's own TypeScript to transpile the module on the fly.
//
// Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));

const source = readFileSync(path.join(here, '../src/utils/recorderCore.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const out = path.join(mkdtempSync(path.join(tmpdir(), 'rc-')), 'recorderCore.mjs');
writeFileSync(out, js);
const core = await import(pathToFileURL(out).href);

test('isSensitiveField flags password inputs and secret-like names', () => {
  assert.equal(core.isSensitiveField({ type: 'password' }), true);
  assert.equal(core.isSensitiveField({ type: 'text', name: 'user_token' }), true);
  assert.equal(core.isSensitiveField({ type: 'text', autocomplete: 'cc-number' }), true);
  assert.equal(core.isSensitiveField({ type: 'text', label: 'Card number' }), true);
  assert.equal(core.isSensitiveField({ type: 'text', name: 'username', label: 'Username' }), false);
});

test('toValueRef always satisfies the backend pattern', () => {
  const re = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
  for (const hint of ['Password', 'my pass word!', '123abc', '', '   ', 'a'.repeat(200), 'ünï-code']) {
    assert.match(core.toValueRef(hint), re, `hint ${JSON.stringify(hint)}`);
  }
});

test('isGeneratedId rejects framework-generated ids and keeps stable ones', () => {
  for (const id of ['react-select-6-option-0-0', 'react-select-2-input', ':r1:', 'radix-:r2:', 'headlessui-menu-button-3', 'mui-12345', 'a3b1c2d4-1111-2222-3333-444455556666']) {
    assert.equal(core.isGeneratedId(id), true, id);
  }
  for (const id of ['username', 'login-button', 'checkout', 'search_box', 'step-2-title']) {
    assert.equal(core.isGeneratedId(id), false, id);
  }
});

test('rankTarget prefers test id, then role+name, then css, then text', () => {
  const t = core.rankTarget({ testId: 'go', role: 'button', name: 'Go', css: '#go', text: 'Go' });
  assert.equal(t.testId, 'go');
  assert.deepEqual(t.fallbacks.map((f) => Object.keys(f)[0]), ['role', 'css', 'text']);
  const noId = core.rankTarget({ role: 'button', name: 'Go', css: '#go' });
  assert.equal(noId.role, 'button');
  assert.equal(noId.fallbacks[0].css, '#go');
  assert.deepEqual(core.rankTarget({ css: '#only' }), { css: '#only' });
});

test('appendStep numbers steps and records select / check / uncheck in order', () => {
  let steps = [];
  steps = core.appendStep(steps, { type: 'select', target: { css: '#plan' }, value: 'pro' });
  steps = core.appendStep(steps, { type: 'check', target: { css: '#agree' } });
  steps = core.appendStep(steps, { type: 'uncheck', target: { css: '#agree' } });
  assert.deepEqual(steps.map((s) => s.id), ['step_001', 'step_002', 'step_003']);
  assert.deepEqual(steps.map((s) => s.type), ['select', 'check', 'uncheck']);
  assert.equal(steps[0].value, 'pro');
});

test('appendStep collapses consecutive fills on one field and consecutive scrolls', () => {
  let steps = [];
  const target = { css: '#u' };
  steps = core.appendStep(steps, { type: 'fill', target, value: 'a' });
  steps = core.appendStep(steps, { type: 'fill', target, value: 'al' });
  steps = core.appendStep(steps, { type: 'fill', target, value: 'alice' });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].value, 'alice');
  assert.equal(steps[0].id, 'step_001');

  steps = core.appendStep(steps, { type: 'fill', target: { css: '#other' }, value: 'x' });
  assert.equal(steps.length, 2);

  steps = core.appendStep(steps, { type: 'scroll', scrollX: 0, scrollY: 100 });
  steps = core.appendStep(steps, { type: 'scroll', scrollX: 0, scrollY: 400 });
  assert.equal(steps.length, 3);
  assert.equal(steps[2].scrollY, 400);
});

test('addSnapshot creates unique, backend-valid checkpoint ids', () => {
  let steps = [];
  steps = core.addSnapshot(steps, 'Dashboard');
  steps = core.addSnapshot(steps, 'Dashboard');
  steps = core.addSnapshot(steps, '  ');
  steps = core.addSnapshot(steps, '../Evil Name!');
  const ids = steps.map((s) => s.checkpointId);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(ids[0], 'dashboard');
  assert.equal(ids[1], 'dashboard_2');
  assert.equal(steps[2].name, 'Snapshot');
});

test('renumber keeps ids unique and ordered after deletes', () => {
  const steps = [
    { id: 'step_001', type: 'click' },
    { id: 'step_003', type: 'click' },
    { id: 'step_007', type: 'click' },
  ];
  assert.deepEqual(core.renumber(steps).map((s) => s.id), ['step_001', 'step_002', 'step_003']);
});
