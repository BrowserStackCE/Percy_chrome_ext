// Unit tests for the branch settings helpers and their chrome.storage wrappers.
// Uses node:test (no new dependency) and the project's own TypeScript to
// transpile the module on the fly, like recorderCore.test.mjs.
//
// Run: npm run test:unit
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Minimal in-memory chrome.storage.local, installed before the module loads.
let store = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return key in store ? { [key]: store[key] } : {};
      },
      async set(obj) {
        Object.assign(store, obj);
      },
      async remove(key) {
        delete store[key];
      },
    },
  },
};

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));

const source = readFileSync(path.join(here, '../src/utils/branchStorage.ts'), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const out = path.join(mkdtempSync(path.join(tmpdir(), 'bs-')), 'branchStorage.mjs');
writeFileSync(out, js);
const bs = await import(pathToFileURL(out).href);

beforeEach(() => {
  store = {};
});

test('defaults when nothing is stored', async () => {
  const s = await bs.getStoredBranchSettings();
  assert.deepEqual(s, { branch: 'percy-local-manager', targetBranch: '' });
  assert.equal(bs.DEFAULT_BRANCH, 'percy-local-manager');
  assert.equal(bs.isDefaultBranchSettings(s), true);
});

test('saved settings are persisted and reloaded', async () => {
  await bs.setStoredBranchSettings({ branch: 'staging', targetBranch: 'production' });
  assert.deepEqual(await bs.getStoredBranchSettings(), {
    branch: 'staging',
    targetBranch: 'production',
  });
  assert.equal(
    bs.isDefaultBranchSettings(await bs.getStoredBranchSettings()),
    false
  );
});

test('reset returns to the defaults', async () => {
  await bs.setStoredBranchSettings({ branch: 'staging', targetBranch: 'production' });
  await bs.resetStoredBranchSettings();
  assert.deepEqual(await bs.getStoredBranchSettings(), {
    branch: 'percy-local-manager',
    targetBranch: '',
  });
});

test('values are trimmed and an empty branch falls back to the default', () => {
  assert.deepEqual(
    bs.normalizeBranchSettings({ branch: '  staging ', targetBranch: ' production ' }),
    { branch: 'staging', targetBranch: 'production' }
  );
  assert.deepEqual(bs.normalizeBranchSettings({ branch: '   ', targetBranch: '  ' }), {
    branch: 'percy-local-manager',
    targetBranch: '',
  });
});

test('garbage in storage is treated as defaults', () => {
  for (const bad of [undefined, null, 42, 'x', [], { branch: 5, targetBranch: {} }]) {
    assert.deepEqual(bs.normalizeBranchSettings(bad), {
      branch: 'percy-local-manager',
      targetBranch: '',
    });
  }
});

test('only the default branch with an empty target counts as default', () => {
  assert.equal(
    bs.isDefaultBranchSettings({ branch: 'percy-local-manager', targetBranch: '' }),
    true
  );
  assert.equal(
    bs.isDefaultBranchSettings({ branch: 'percy-local-manager', targetBranch: 'production' }),
    false
  );
  assert.equal(
    bs.isDefaultBranchSettings({ branch: 'staging', targetBranch: '' }),
    false
  );
});
