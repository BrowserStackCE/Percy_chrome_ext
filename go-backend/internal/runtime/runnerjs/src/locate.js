// Locator resolution. Order of preference matches the recorder:
// test id, role+name, CSS, text. Recorded fallbacks are tried in order.
// A locator that matches MORE THAN ONE element is an error: we fail safely
// rather than act on an arbitrary element.

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

/**
 * Resolves `target` to exactly one element. Waits up to timeoutMs for the
 * primary locator, then tries fallbacks briefly. Throws LocatorError.
 */
export async function resolve(page, target, timeoutMs) {
  const list = candidates(target);
  if (list.length === 0) throw new LocatorError('step has no usable locator', 'missing');

  const tried = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const loc = build(page, c);
    // primary gets the full timeout; fallbacks a short grace period
    const wait = i === 0 ? timeoutMs : Math.min(1500, timeoutMs);
    try {
      await loc.first().waitFor({ state: 'attached', timeout: wait });
    } catch {
      tried.push(`${describe(c)} (not found)`);
      continue;
    }
    const n = await loc.count();
    if (n === 1) return loc;
    if (n > 1) {
      tried.push(`${describe(c)} (matched ${n} elements)`);
      // ambiguous primary is a hard stop: do not silently switch strategy
      if (i === 0) {
        throw new LocatorError(`locator ${describe(c)} matched ${n} elements; refusing to act on an arbitrary one`, 'ambiguous');
      }
    }
  }
  throw new LocatorError(`no element found. Tried: ${tried.join('; ')}`, 'missing');
}
