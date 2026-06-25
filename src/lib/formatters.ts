/**
 * Display formatters for dashboard numbers.
 * All numbers in the dashboard should go through one of these so formatting
 * is consistent and currency / locale don't drift between cards.
 */

export function formatNumber(n: number | null | undefined, fractionDigits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatCurrency(n: number | null | undefined, fractionDigits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatPercent(n: number | null | undefined, fractionDigits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  return `${(n * 100).toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
}

export function formatMultiplier(n: number | null | undefined, fractionDigits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n) || !Number.isFinite(n)) return "—";
  return `${n.toFixed(fractionDigits)}×`;
}

/** Safe division: returns null when denominator is zero/nullish. */
export function safeDiv(num: number | null | undefined, denom: number | null | undefined): number | null {
  if (num === null || num === undefined) return null;
  if (denom === null || denom === undefined || denom === 0) return null;
  return num / denom;
}

/**
 * Format a Date as a CALENDAR DATE (no time component) using UTC.
 *
 * Why this exists: throughout this app, calendar dates are stored as
 * "yyyy-MM-dd" strings (e.g. period cookie, Supabase queries on
 * daily_metrics_v.day). When we parse them via parseISO() on the server
 * (Vercel edge = UTC), we get a Date at UTC midnight. Round-tripping
 * that Date through .toISOString() and reconstructing on the client
 * keeps the UTC instant correct, but date-fns `format()` then renders
 * it in the BROWSER'S LOCAL timezone — so a Date representing
 * 2026-02-19 UTC midnight shows "Feb 18, 2026" to a user in Central
 * (because Feb 18 19:00 CDT is the same instant).
 *
 * Use this helper everywhere we display a "calendar date" — pulled from
 * a yyyy-MM-dd string, or representing a phase boundary. Don't use it
 * for actual timestamps (last-updated, etl_runs timestamps, etc.) —
 * those genuinely want local-time display.
 */
export function formatCalendarDate(
  d: Date,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...options,
  }).format(d);
}
