/**
 * Cookie-backed user preferences (date range + tier).
 *
 * Why cookies (not URL params or localStorage):
 *   - Server components can read them during SSR for a correct first paint
 *     (localStorage can't — it's client-only)
 *   - Keeps the URL clean (no ?start=...&end=...&tier=... query string)
 *   - Persists across browser sessions automatically
 *
 * Format:
 *   - `ps_period`: "YYYY-MM-DD:YYYY-MM-DD"  (start:end)
 *   - `ps_tier`:   "simple" | "advanced"
 *
 * Cookies are scoped to path=/ so they apply across every client's dashboard.
 */

const PERIOD_COOKIE = "ps_period";
/** Separate period cookie for /socials so its range is independent of /ads. */
export const SOCIALS_PERIOD_COOKIE = "ps_socials_period";
/** Separate period cookie for /seo so its range is independent of /ads + /socials. */
export const SEO_PERIOD_COOKIE = "ps_seo_period";
const TIER_COOKIE = "ps_tier";
const VIEW_MODE_COOKIE = "ps_view_mode";
/** Light / dark theme. Absent = "follow the device" (OS prefers-color-scheme). */
const THEME_COOKIE = "ps_theme";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Real vs Projected — drives the entire dashboard's display mode. */
export type ViewMode = "real" | "projected";

/** Platform-wide light/dark theme. */
export type Theme = "light" | "dark";

// ── Server-side reads (used in Server Components) ─────────────────────────────

type Cookies = { get: (name: string) => { value: string } | undefined };

export function readPeriodFromCookies(
  cookies: Cookies,
  cookieName: string = PERIOD_COOKIE,
): { start: string; end: string } | null {
  const raw = cookies.get(cookieName)?.value;
  if (!raw) return null;
  const [start, end] = raw.split(":");
  if (!start || !end) return null;
  return { start, end };
}

export function readTierFromCookies(cookies: Cookies): "simple" | "advanced" | null {
  const raw = cookies.get(TIER_COOKIE)?.value;
  if (raw === "simple" || raw === "advanced") return raw;
  return null;
}

export function readViewModeFromCookies(cookies: Cookies): ViewMode | null {
  const raw = cookies.get(VIEW_MODE_COOKIE)?.value;
  if (raw === "real" || raw === "projected") return raw;
  return null;
}

/** Returns the saved theme, or null when the user hasn't chosen yet (in which
 *  case the pre-hydration script falls back to the OS preference). */
export function readThemeFromCookies(cookies: Cookies): Theme | null {
  const raw = cookies.get(THEME_COOKIE)?.value;
  if (raw === "light" || raw === "dark") return raw;
  return null;
}

// ── Client-side writes (used from Date picker / Tier selector) ────────────────

function isBrowser(): boolean {
  return typeof document !== "undefined";
}

export function writePeriodCookie(startISO: string, endISO: string, cookieName: string = PERIOD_COOKIE) {
  if (!isBrowser()) return;
  document.cookie = `${cookieName}=${startISO}:${endISO}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

export function writeTierCookie(tier: "simple" | "advanced") {
  if (!isBrowser()) return;
  document.cookie = `${TIER_COOKIE}=${tier}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

export function writeViewModeCookie(mode: ViewMode) {
  if (!isBrowser()) return;
  document.cookie = `${VIEW_MODE_COOKIE}=${mode}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

export function writeThemeCookie(theme: Theme) {
  if (!isBrowser()) return;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/**
 * The inline script string injected (un-hydrated) at the top of <body> so the
 * correct theme is set BEFORE first paint — no flash. Reads the ps_theme
 * cookie; if absent, follows the OS `prefers-color-scheme`. Kept as a tiny
 * self-contained IIFE string because it must run before React hydrates.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )ps_theme=(light|dark)/);var t=m?m[1]:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
