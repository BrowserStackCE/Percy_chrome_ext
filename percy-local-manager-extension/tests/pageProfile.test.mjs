// Page-type detection rules (pure functions, no DOM). Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = path.dirname(fileURLToPath(import.meta.url));
const js = ts.transpileModule(readFileSync(path.join(here, '../src/utils/pageProfile.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const out = path.join(mkdtempSync(path.join(tmpdir(), 'pp-')), 'pageProfile.mjs');
writeFileSync(out, js);
const pp = await import(pathToFileURL(out).href);

const base = {
  next: false, react: false, drupal: false, bootstrap: false,
  totalIds: 0, numericIds: 0, hashedClasses: 0, hoverMenus: 0, carousels: 0, dialogs: 0,
  stickyTopBars: 0, consentManager: false,
};

test('a Next.js shop with numeric list ids and a sticky navbar is an SPA that distrusts ids', () => {
  // measured on https://bstackdemo.com/
  const p = pp.detectProfile({ ...base, next: true, react: true, totalIds: 34, numericIds: 25, hashedClasses: 7, stickyTopBars: 1 });
  assert.equal(p.kind, 'spa');
  assert.equal(p.locators.distrustNumericIds, true);
  assert.equal(p.locators.distrustHashedClasses, true);
  assert.equal(p.locators.preferSemantic, true);
  assert.equal(p.clicks.stickyBars, true);
  assert.equal(p.waits.hydration, true);
});

test('a Drupal/Bootstrap site with hover menus, carousels and a consent manager is a CMS', () => {
  // measured on https://www.neilson.co.uk/black-friday
  const p = pp.detectProfile({ ...base, drupal: true, bootstrap: true, totalIds: 40, hoverMenus: 4, carousels: 33, dialogs: 1, stickyTopBars: 1, consentManager: true });
  assert.equal(p.kind, 'cms');
  assert.equal(p.locators.distrustNumericIds, false);
  assert.equal(p.clicks.hoverMenus, true);
  assert.equal(p.waits.freezeMotion, true);
  assert.equal(p.waits.consent, true);
  assert.equal(p.waits.hydration, false);
});

test('a plain page gets the neutral profile', () => {
  const p = pp.detectProfile(base);
  assert.equal(p.kind, 'static');
  assert.equal(p.clicks.stickyBars, false);
  assert.equal(p.waits.settleMs, 0);
  assert.deepEqual(p.reasons, []);
  assert.deepEqual(pp.DEFAULT_PROFILE.locators, p.locators);
});

test('isNumericId and isHashedClass', () => {
  assert.equal(pp.isNumericId('1'), true);
  assert.equal(pp.isNumericId('42'), true);
  assert.equal(pp.isNumericId('login'), false);
  assert.equal(pp.isNumericId('step-2'), false);
  assert.equal(pp.isHashedClass('Navbar_root__2kbI9'), true);
  assert.equal(pp.isHashedClass('shelf-item__buy-btn'), false);
  assert.equal(pp.isHashedClass('btn btn-primary'), false);
});
