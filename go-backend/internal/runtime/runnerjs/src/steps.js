import { resolve, resolveLoose, describe } from './locate.js';
import { dismissConsent, botBlockReason } from './stabilize.js';
import { emit } from './events.js';

// Each executor throws on failure (the caller records the failed step and stops).
// Waits are condition-based (Playwright auto-wait / waitFor), never fixed sleeps.

function timeoutOf(step, settings) {
  return step.timeoutMs || settings?.defaultTimeoutMs || 10000;
}

// Literal value, or a secret resolved at run time. Secret values are never
// emitted in events or error messages.
function valueOf(step, secrets) {
  if (step.valueRef) {
    const v = secrets?.[step.valueRef];
    if (v === undefined) {
      throw new Error(`secret "${step.valueRef}" was not provided for this run`);
    }
    return v;
  }
  return step.value ?? '';
}

const MIN_NAV_TIMEOUT_MS = 30000;

/**
 * Open a URL. Real sites load slowly (ads, analytics, large images), so this
 * waits only for DOMContentLoaded and allows at least 30s, independent of the
 * per-action timeout. A short best-effort wait for `load` follows so the page
 * is mostly settled; if it does not fire in time the run carries on, because
 * every snapshot still waits for its own conditions.
 */
export async function navigate(page, url, requestedTimeoutMs, opts = {}) {
  const timeout = Math.max(requestedTimeoutMs || 0, MIN_NAV_TIMEOUT_MS);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  const blocked = await botBlockReason(page);
  if (blocked) throw new Error(blocked);
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  // Best effort: let client-side apps finish rendering before the next action.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  if (opts.autoConsent) await dismissConsent(page, 3000);
}

// Short first attempt: a normal click either lands quickly or is blocked by an
// overlay; waiting the whole step timeout on a blocked click helps nobody.
const CLICK_PROBE_MS = 3000;

/**
 * Finds a point of the element that is actually on top (not covered by a
 * sticky header, banner or other overlay). A real user clicks the visible part
 * of a partly covered button; Playwright's centre click does not.
 */
async function uncoveredPoint(loc) {
  return loc.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const cols = 6;
    const rows = 6;
    let best = null;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = r.left + ((i + 0.5) * r.width) / cols;
        const y = r.top + ((j + 0.5) * r.height) / rows;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (top !== el && !el.contains(top)) continue;
        // prefer the point closest to the element centre
        const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best && { x: best.x, y: best.y };
  });
}

/**
 * Click that survives partial overlays: normal click, then (when another
 * element intercepts the pointer) a click on the uncovered part of the target,
 * and finally a dispatched click event on the element itself.
 */
async function robustClick(page, loc, timeoutMs, profile) {
  // On a page with a sticky/fixed top bar a centre click is often covered; go
  // straight to the uncovered part instead of waiting out a blocked first try.
  const first = profile?.clicks?.stickyBars ? Math.min(1500, timeoutMs) : Math.min(CLICK_PROBE_MS, timeoutMs);
  try {
    await loc.click({ timeout: first });
    return;
  } catch (e) {
    const msg = String(e.message || e);
    if (!/intercepts pointer events|Timeout/.test(msg)) throw e;
    const pt = await uncoveredPoint(loc).catch(() => null);
    if (pt) {
      await page.mouse.click(pt.x, pt.y);
      emit({ type: 'log', message: 'click: target partly covered, clicked its uncovered part' });
      return;
    }
    // Fully covered or off-screen: last resort, fire the click on the element.
    await loc.dispatchEvent('click', undefined, { timeout: Math.max(1000, timeoutMs - first) });
    emit({ type: 'log', message: 'click: target covered, dispatched click event on it' });
  }
}

export const executors = {
  async click(page, step, ctx) {
    const loc = await resolve(page, step.target, timeoutOf(step, ctx.settings));
    // SPAs re-render after an action; give React/Next a moment to settle first.
    if (ctx.profile?.waits?.settleMs) await page.waitForTimeout(ctx.profile.waits.settleMs);
    await robustClick(page, loc, timeoutOf(step, ctx.settings), ctx.profile);
  },

  async fill(page, step, ctx) {
    const loc = await resolve(page, step.target, timeoutOf(step, ctx.settings));
    await loc.fill(valueOf(step, ctx.secrets), { timeout: timeoutOf(step, ctx.settings) });
  },

  async select(page, step, ctx) {
    const loc = await resolve(page, step.target, timeoutOf(step, ctx.settings));
    await loc.selectOption(valueOf(step, ctx.secrets), { timeout: timeoutOf(step, ctx.settings) });
  },

  async check(page, step, ctx) {
    const loc = await resolve(page, step.target, timeoutOf(step, ctx.settings));
    await loc.check({ timeout: timeoutOf(step, ctx.settings) });
  },

  async uncheck(page, step, ctx) {
    const loc = await resolve(page, step.target, timeoutOf(step, ctx.settings));
    await loc.uncheck({ timeout: timeoutOf(step, ctx.settings) });
  },

  async navigate(page, step, ctx) {
    await navigate(page, step.url, timeoutOf(step, ctx.settings), { autoConsent: ctx.settings?.autoConsent });
  },

  // Opens hover-driven menus: move the pointer over the trigger and give the
  // menu a moment to render; clicks on its items follow as normal steps.
  async hover(page, step, ctx) {
    const loc = await resolve(page, step.target, timeoutOf(step, ctx.settings));
    await loc.hover({ timeout: timeoutOf(step, ctx.settings) });
    await page.waitForTimeout(250);
  },

  async waitFor(page, step, ctx) {
    const ms = timeoutOf(step, ctx.settings);
    const state = { visible: 'visible', hidden: 'hidden', attached: 'attached', detached: 'detached' }[step.condition || 'visible'];
    // For "hidden"/"detached" the element may legitimately never exist.
    const loc = await resolveForWait(page, step, ms, state);
    await loc.first().waitFor({ state, timeout: ms });
  },

  async scroll(page, step) {
    await page.evaluate(([x, y]) => window.scrollTo(x, y), [step.scrollX ?? 0, step.scrollY ?? 0]);
  },
};

async function resolveForWait(page, step, ms, state) {
  if (state === 'hidden' || state === 'detached') {
    // Do not require the element to exist; wait on the primary strategy only.
    return resolveLoose(page, step.target);
  }
  return resolve(page, step.target, ms);
}

export function stepLabel(step) {
  return step.target ? `${step.type} ${describe(step.target)}` : step.type;
}
