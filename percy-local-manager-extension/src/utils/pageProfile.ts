/**
 * Page-type detection shared by the recorder (content script) and, as a copy of
 * the same rules, by the replay runner. Pure functions only: the DOM facts are
 * gathered elsewhere (see collectSignals) and passed in, so every rule here is
 * unit-testable without a browser.
 *
 * A "profile" decides HOW to treat a page:
 *  - locators: which kinds of attribute are trustworthy on this site
 *  - clicks:   whether sticky/fixed bars or hover menus need special handling
 *  - waits:    how long to let the page settle before acting / snapshotting
 */

export interface PageSignals {
  /** Framework markers. */
  next: boolean;
  react: boolean;
  drupal: boolean;
  bootstrap: boolean;
  /** Counts of elements. */
  totalIds: number;
  numericIds: number;
  hashedClasses: number;
  hoverMenus: number;
  carousels: number;
  dialogs: number;
  /** Sticky/fixed full-width bars at the top of the page. */
  stickyTopBars: number;
  /** A known consent manager is on the page. */
  consentManager: boolean;
}

export type PageKind = 'spa' | 'cms' | 'static';

export interface PageProfile {
  kind: PageKind;
  /** Short, human readable reasons (shown in the run log and the panel). */
  reasons: string[];
  locators: {
    /** Ids that are only digits (React keys) or generated are never locators. */
    distrustNumericIds: boolean;
    /** CSS-module / hashed class names are never locators. */
    distrustHashedClasses: boolean;
    /** Prefer visible text, role and data attributes over class chains. */
    preferSemantic: boolean;
  };
  clicks: {
    /** A sticky/fixed bar can cover targets: click the uncovered part first. */
    stickyBars: boolean;
    /** Menus open on hover: record/replay a hover before items inside. */
    hoverMenus: boolean;
  };
  waits: {
    /** Let client-side rendering finish before acting. */
    hydration: boolean;
    /** Pause carousels / animations before snapshots. */
    freezeMotion: boolean;
    /** Dismiss cookie banners and pop-ups. */
    consent: boolean;
    /** Extra settle time (ms) added before a snapshot. */
    settleMs: number;
  };
}

const HASHED_CLASS = /(^|\s)[A-Za-z]+_[A-Za-z0-9]+__[A-Za-z0-9]{4,}(\s|$)/;

/** True for a CSS-module style class such as Navbar_root__2kbI9. */
export function isHashedClass(cls: string): boolean {
  return HASHED_CLASS.test(cls);
}

/** True for ids that are just digits ("1", "42"): list keys, never stable. */
export function isNumericId(id: string): boolean {
  return /^\d+$/.test(id);
}

export function detectProfile(s: PageSignals): PageProfile {
  const reasons: string[] = [];

  const numericRatio = s.totalIds > 0 ? s.numericIds / s.totalIds : 0;
  const spa = s.next || s.react;
  const cms = s.drupal || s.bootstrap;

  if (s.next) reasons.push('Next.js app');
  else if (s.react) reasons.push('React app');
  if (s.drupal) reasons.push('Drupal site');
  if (s.bootstrap) reasons.push('Bootstrap UI');

  const distrustNumericIds = s.numericIds >= 3 || numericRatio >= 0.3;
  if (distrustNumericIds) reasons.push(`${s.numericIds} numeric ids (list keys)`);

  const distrustHashedClasses = s.hashedClasses >= 3;
  if (distrustHashedClasses) reasons.push(`${s.hashedClasses} hashed CSS-module classes`);

  const stickyBars = s.stickyTopBars > 0;
  if (stickyBars) reasons.push('sticky/fixed top bar');

  const hoverMenus = s.hoverMenus > 0;
  if (hoverMenus) reasons.push(`${s.hoverMenus} hover/dropdown menu trigger(s)`);

  const freezeMotion = s.carousels > 0;
  if (freezeMotion) reasons.push(`${s.carousels} carousel(s)`);

  const consent = s.consentManager || s.dialogs > 0;
  if (s.consentManager) reasons.push('cookie consent manager');

  const kind: PageKind = spa ? 'spa' : cms ? 'cms' : 'static';

  return {
    kind,
    reasons,
    locators: {
      distrustNumericIds,
      distrustHashedClasses,
      preferSemantic: distrustNumericIds || distrustHashedClasses || spa,
    },
    clicks: { stickyBars, hoverMenus },
    waits: {
      hydration: spa,
      freezeMotion,
      consent,
      settleMs: spa ? 500 : cms ? 300 : 0,
    },
  };
}

/** Neutral profile used when detection has not run (older workflows). */
export const DEFAULT_PROFILE: PageProfile = detectProfile({
  next: false,
  react: false,
  drupal: false,
  bootstrap: false,
  totalIds: 0,
  numericIds: 0,
  hashedClasses: 0,
  hoverMenus: 0,
  carousels: 0,
  dialogs: 0,
  stickyTopBars: 0,
  consentManager: false,
});

/**
 * Runs in the page (content script) or via page.evaluate in the runner:
 * gathers the raw facts detectProfile needs. Kept dependency free so its source
 * can be serialised into the runner.
 */
export function collectSignals(doc: Document, win: Window): PageSignals {
  const all = Array.from(doc.querySelectorAll('*'));
  const withId = all.filter((e) => e.id);
  const w = win as unknown as Record<string, unknown>;
  const sticky = all.filter((e) => {
    const st = win.getComputedStyle(e);
    if (st.position !== 'sticky' && st.position !== 'fixed') return false;
    const r = e.getBoundingClientRect();
    return r.height > 30 && r.top <= 5 && r.width > win.innerWidth * 0.6;
  });
  return {
    next: !!doc.getElementById('__next') || !!w.__NEXT_DATA__ || !!doc.querySelector('script[src*="/_next/"]'),
    react:
      !!doc.querySelector('[data-reactroot]') ||
      all.slice(0, 400).some((e) => Object.keys(e).some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'))),
    drupal: !!w.Drupal || !!doc.querySelector('meta[name=Generator][content*=Drupal]'),
    bootstrap: !!doc.querySelector('[data-bs-toggle]') || !!w.bootstrap,
    totalIds: withId.length,
    numericIds: withId.filter((e) => /^\d+$/.test(e.id)).length,
    hashedClasses: all.filter((e) => typeof e.className === 'string' && HASHED_CLASS.test(e.className)).length,
    hoverMenus: doc.querySelectorAll('[data-once*=hover], [aria-haspopup=true], .dropdown-toggle').length,
    carousels: doc.querySelectorAll('.carousel, .swiper, .slick-slider, [class*=carousel]').length,
    dialogs: doc.querySelectorAll('dialog, [role=dialog]').length,
    stickyTopBars: sticky.length,
    consentManager: !!doc.querySelector(
      '[data-testid="actionButton-accept"], #onetrust-accept-btn-handler, #CybotCookiebotDialog, #didomi-host',
    ),
  };
}
