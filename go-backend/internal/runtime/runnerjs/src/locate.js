// Locator resolution. Order of preference matches the recorder:
// test id, role+name, CSS, text. Recorded fallbacks are tried in order.
// All strategies are polled together; an ambiguous match is narrowed to the
// visible elements before it is treated as an error.

export class LocatorError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'missing' | 'ambiguous'
  }
}

export function describe(t) {
  if (!t) return '(no target)';
  if (t.testId) return `testId=${t.testId}`;
  if (t.role && t.name) return `role=${t.role}[name="${t.name}"]`;
  if (t.css) return `css=${t.css}`;
  if (t.text) return `text="${t.text}"`;
  return '(empty target)';
}

function build(page, t) {
  if (t.testId) return page.getByTestId(t.testId);
  if (t.role && t.name) return page.getByRole(t.role, { name: t.name, exact: true });
  if (t.role) return page.getByRole(t.role);
  if (t.css) return page.locator(t.css);
  if (t.text) return page.getByText(t.text, { exact: true });
  return null;
}

function usable(t) {
  return Boolean(t.testId || t.role || t.css || t.text);
}

function candidates(target) {
  const { fallbacks, ...primary } = target;
  return [primary, ...(fallbacks ?? [])].filter(usable);
}

/**
 * Locator for waitFor hidden/detached: the element may legitimately not exist,
 * so there is no existence wait and no "exactly one" requirement. Uses the
 * primary strategy only.
 */
export function resolveLoose(page, target) {
  const { fallbacks, ...primary } = target;
  const loc = build(page, primary);
  if (!loc) throw new LocatorError('step has no usable locator', 'missing');
  return loc;
}

const POLL_MS = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Looks at one candidate right now. Returns {loc, n} where loc is a locator
 * for exactly one element (or null) and n is the raw match count. When a
 * candidate matches several elements, narrows to the visible ones; if exactly
 * one is visible that is unambiguous enough to act on.
 */
async function probe(page, c) {
  const loc = build(page, c);
  if (!loc) return { loc: null, n: 0 };
  let n;
  try {
    n = await loc.count();
  } catch {
    return { loc: null, n: 0 }; // e.g. invalid selector: treat as not found
  }
  if (n === 1) return { loc, n };
  if (n > 1) {
    const visible = loc.filter({ visible: true });
    const v = await visible.count().catch(() => 0);
    if (v === 1) return { loc: visible, n, visibleOnly: true };
    return { loc: null, n, visibleCount: v };
  }
  return { loc: null, n: 0 };
}

/**
 * Resolves `target` to one element. Every recorded strategy (primary and
 * fallbacks) is re-checked on each poll until the timeout, so a page that
 * renders late, or a primary locator that stops matching, still resolves via
 * another strategy. Candidates are ranked: the highest-priority one that is
 * unique (or unique among visible elements) wins. If nothing is ever unique
 * the step fails safely rather than acting on an arbitrary element. Throws
 * LocatorError listing everything that was tried.
 */
export async function resolve(page, target, timeoutMs) {
  const list = candidates(target);
  if (list.length === 0) throw new LocatorError('step has no usable locator', 'missing');

  const deadline = Date.now() + timeoutMs;
  let last = [];
  for (;;) {
    const results = [];
    for (const c of list) results.push(await probe(page, c));
    last = results;
    const hit = results.find((r) => r.loc);
    if (hit) return hit.loc;
    if (Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }

  // Nothing was unique across ALL strategies: refuse to act on an arbitrary
  // element. The error lists every strategy and its match count.
  const tried = list.map((c, i) => {
    const r = last[i];
    if (r?.n > 1) return `${describe(c)} (matched ${r.n} elements)`;
    return `${describe(c)} (not found)`;
  });
  const anyAmbiguous = last.some((r) => r?.n > 1);
  throw new LocatorError(`no element found. Tried: ${tried.join('; ')}`, anyAmbiguous ? 'ambiguous' : 'missing');
}
