// Replay-side helpers for real-world sites: consent banners, rotating
// carousels, lazy content and tracker noise. Everything here is best effort and
// never throws into the run.
import { emit } from './events.js';

// Known consent "accept" controls (CookieFirst, OneTrust, Cookiebot, Didomi,
// Usercentrics, TrustArc, generic). Tried in order, only visible ones clicked.
const CONSENT_SELECTORS = [
  '[data-testid="actionButton-accept"]',
  '[data-cookiefirst-action="accept"]',
  '#onetrust-accept-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#didomi-notice-agree-button',
  '[data-testid="uc-accept-all-button"]',
  '#truste-consent-button',
];

export async function dismissConsent(page, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const sel of CONSENT_SELECTORS) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.isVisible()) {
          await loc.click({ timeout: 2000 });
          emit({ type: 'log', message: `consent banner dismissed (${sel})` });
          await page.waitForTimeout(300);
          return true;
        }
      } catch {
        /* try the next one */
      }
    }
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(250);
  }
}

// Heavy third-party noise that never settles and changes between runs.
const BLOCKED_HOSTS =
  /(doubleclick\.net|googlesyndication\.com|google-analytics\.com|clarity\.ms|contentsquare\.(net|com)|heap-api\.com|heapanalytics\.com|fullstory\.com|hotjar\.com|criteo\.(com|net)|taboola\.com|outbrain\.com|adnxs\.com|rubiconproject\.com|pubmatic\.com|casalemedia\.com|bidswitch\.net|ads-twitter\.com|facebook\.net|bat\.bing\.com|talkdesk(app)?\.com)/i;

export async function blockNoise(context) {
  await context.route(BLOCKED_HOSTS, (route) => route.abort()).catch(() => {});
}

// Freeze motion, pause carousels and load lazy content so two runs of the same
// page serialize to (nearly) the same DOM.
export async function stabilizePage(page) {
  await page
    .addStyleTag({
      content: '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}',
    })
    .catch(() => {});
  await page
    .evaluate(async () => {
      document.querySelectorAll('video').forEach((v) => {
        try {
          v.pause();
        } catch {
          /* ignore */
        }
      });
      document.querySelectorAll('.carousel').forEach((c) => {
        try {
          const BS = window.bootstrap && window.bootstrap.Carousel;
          const inst = BS && BS.getInstance(c);
          if (inst) inst.pause();
        } catch {
          /* ignore */
        }
        c.setAttribute('data-bs-interval', 'false');
      });
      // Scroll through the page once so lazy images/widgets load, then back.
      const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
      const max = Math.min(document.documentElement.scrollHeight, 30000);
      for (let y = 0; y < max; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 80));
      }
      window.scrollTo(0, 0);
      if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});
      const pending = Array.from(document.images).filter((i) => !i.complete);
      await Promise.race([
        Promise.all(
          pending.map(
            (i) =>
              new Promise((r) => {
                i.addEventListener('load', r, { once: true });
                i.addEventListener('error', r, { once: true });
              }),
          ),
        ),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
    })
    .catch(() => {});
}

// ---- page type ----------------------------------------------------------
// Same rules as percy-local-manager-extension/src/utils/pageProfile.ts so the
// page is treated the same way at record time and at replay time.

export function detectProfileFrom(s) {
  const numericRatio = s.totalIds > 0 ? s.numericIds / s.totalIds : 0;
  const spa = s.next || s.react;
  const cms = s.drupal || s.bootstrap;
  const reasons = [];
  if (s.next) reasons.push('Next.js app');
  else if (s.react) reasons.push('React app');
  if (s.drupal) reasons.push('Drupal site');
  if (s.bootstrap) reasons.push('Bootstrap UI');
  if (s.stickyTopBars > 0) reasons.push('sticky/fixed top bar');
  if (s.hoverMenus > 0) reasons.push(`${s.hoverMenus} hover/dropdown menu trigger(s)`);
  if (s.carousels > 0) reasons.push(`${s.carousels} carousel(s)`);
  return {
    kind: spa ? 'spa' : cms ? 'cms' : 'static',
    reasons,
    locators: { distrustNumericIds: s.numericIds >= 3 || numericRatio >= 0.3 },
    clicks: { stickyBars: s.stickyTopBars > 0, hoverMenus: s.hoverMenus > 0 },
    waits: {
      hydration: spa,
      freezeMotion: s.carousels > 0,
      consent: s.consentManager || s.dialogs > 0,
      settleMs: spa ? 500 : cms ? 300 : 0,
    },
  };
}

// Gathers the raw facts in the page; kept in sync with collectSignals() in the extension.
export async function detectPageProfile(page) {
  try {
    const signals = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const withId = all.filter((e) => e.id);
      const sticky = all.filter((e) => {
        const st = getComputedStyle(e);
        if (st.position !== 'sticky' && st.position !== 'fixed') return false;
        const r = e.getBoundingClientRect();
        return r.height > 30 && r.top <= 5 && r.width > innerWidth * 0.6;
      });
      return {
        next: !!document.getElementById('__next') || !!window.__NEXT_DATA__ || !!document.querySelector('script[src*="/_next/"]'),
        react:
          !!document.querySelector('[data-reactroot]') ||
          all.slice(0, 400).some((e) => Object.keys(e).some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer'))),
        drupal: !!window.Drupal || !!document.querySelector('meta[name=Generator][content*=Drupal]'),
        bootstrap: !!document.querySelector('[data-bs-toggle]') || !!window.bootstrap,
        totalIds: withId.length,
        numericIds: withId.filter((e) => /^\d+$/.test(e.id)).length,
        hoverMenus: document.querySelectorAll('[data-once*=hover], [aria-haspopup=true], .dropdown-toggle').length,
        carousels: document.querySelectorAll('.carousel, .swiper, .slick-slider, [class*=carousel]').length,
        dialogs: document.querySelectorAll('dialog, [role=dialog]').length,
        stickyTopBars: sticky.length,
        consentManager: !!document.querySelector(
          '[data-testid="actionButton-accept"], #onetrust-accept-btn-handler, #CybotCookiebotDialog, #didomi-host',
        ),
      };
    });
    const profile = detectProfileFrom(signals);
    emit({ type: 'log', message: `page type: ${profile.kind}${profile.reasons.length ? ' (' + profile.reasons.join(', ') + ')' : ''}` });
    return profile;
  } catch {
    return detectProfileFrom({ totalIds: 0, numericIds: 0, hoverMenus: 0, carousels: 0, dialogs: 0, stickyTopBars: 0 });
  }
}

// A page that is clearly a bot challenge, not the site (Imperva, Cloudflare...).
export async function botBlockReason(page) {
  try {
    const title = (await page.title()).toLowerCase();
    const text = ((await page.locator('body').innerText({ timeout: 2000 })) || '').slice(0, 600).toLowerCase();
    const hay = `${title} ${text}`;
    if (/incapsula|imperva|request unsuccessful/.test(hay)) return 'blocked by bot protection (Imperva/Incapsula)';
    if (/attention required|checking your browser|just a moment|verify you are human|captcha/.test(hay)) {
      return 'blocked by bot protection (challenge page)';
    }
  } catch {
    /* page not readable: not a verdict */
  }
  return null;
}
