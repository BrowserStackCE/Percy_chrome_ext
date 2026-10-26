import { resolve, resolveLoose, describe } from './locate.js';

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
export async function navigate(page, url, requestedTimeoutMs) {
  const timeout = Math.max(requestedTimeoutMs || 0, MIN_NAV_TIMEOUT_MS);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
  // Best effort: let client-side apps finish rendering before the next action.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}

export const executors = {
  async click(page, step, ctx) {
    const loc = await resolve(page, step.target, timeoutOf(step, ctx.settings));
    await loc.click({ timeout: timeoutOf(step, ctx.settings) });
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
    await navigate(page, step.url, timeoutOf(step, ctx.settings));
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
