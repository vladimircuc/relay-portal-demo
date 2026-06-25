/**
 * Real-vs-Projected math.
 *
 * The dashboard's headline metrics (revenue, ROAS, shows, conversions,
 * source breakdown, etc.) can be displayed in two modes:
 *
 *   real        What's actually been recorded so far.
 *   projected   What we'd land at IF every currently-outstanding
 *               appointment in the displayed period plays out at
 *               historical rates.
 *
 *   projected_revenue = actual_revenue
 *     + outstanding × show_rate × close_rate × avg_revenue_per_conversion
 *
 * Two important decisions baked in here:
 *
 * 1. Rates are STABILISED over a 90-day-or-max window.
 *    The displayed period might be short (last 7 days, no conversions →
 *    close_rate = 0 → projection = 0, useless). So we always pull
 *    show_rate / close_rate / avg_rev_per_conversion from a longer
 *    window — last 90 days, or back to the client's first opp date if
 *    that's shorter. The window stays the same regardless of what
 *    period the user is currently viewing — only the outstanding count
 *    comes from the displayed period.
 *
 * 2. Deterministic, not Monte Carlo.
 *    Every outstanding opp's source is known, so for per-source
 *    projection we don't need to randomise — we multiply each
 *    source's outstanding count by the same three rates. The expected
 *    value of a simulation IS this number; running the simulation
 *    only adds variance info (which we don't show yet).
 */
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/server";
import type { DailyMetricsRow } from "@/lib/types";
import { aggregate, type Aggregates } from "@/lib/metrics";

const PROJECTION_WINDOW_DAYS = 90;
const REVALIDATE_SECONDS = 300;

export type ProjectionRates = {
  /** Sample window covered, in days. ≤ 90, or fewer if data is younger. */
  windowDays: number;
  windowStart: string;  // yyyy-MM-dd, inclusive
  windowEnd: string;    // yyyy-MM-dd, inclusive
  /** Cumulative-funnel-stage rate samples — null when the denominator
   *  in the window was zero (not enough data to project). */
  show_rate: number | null;             // shows / bookings
  close_rate: number | null;            // conversions / shows
  avg_revenue_per_conversion: number | null;
  /** Sample sizes — useful for an "is this projection trustworthy?"
   *  banner. A close_rate computed off 3 shows is way noisier than
   *  off 300, even if both round to the same percent. */
  bookingsInWindow: number;
  showsInWindow: number;
  conversionsInWindow: number;
};

const _fetchProjectionRatesRaw = async (
  clientId: string,
  windowEnd: string,
): Promise<ProjectionRates> => {
  // Window: last 90 days ending on `windowEnd`. If the client has less
  // than 90 days of data, the gte filter just returns whatever exists —
  // we report the actual day count below.
  //
  // UTC anchoring matters here. With a local-TZ Date + setDate(),
  // crossing a DST boundary silently shifts the resulting UTC ms by
  // an hour, so the inclusive day count comes out one short (banner
  // reads "89 days" instead of 90 in spring/fall). Pinning to UTC
  // midnight makes the arithmetic DST-immune.
  const end = new Date(windowEnd + "T00:00:00Z");
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (PROJECTION_WINDOW_DAYS - 1));
  const windowStart = start.toISOString().slice(0, 10);

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("daily_metrics_v")
    .select("*")
    .eq("client_id", clientId)
    .gte("day", windowStart)
    .lte("day", windowEnd)
    .order("day", { ascending: true });

  const rows = (data ?? []) as DailyMetricsRow[];
  const agg = aggregate(rows);

  // If the first row is later than `windowStart`, we have fewer than
  // 90 days of data — report the effective window so the UI can say
  // "based on last 47 days" honestly.
  const effectiveStart = rows.length > 0 ? rows[0].day : windowEnd;
  const effectiveWindowDays = Math.max(1, daysBetween(effectiveStart, windowEnd));

  return {
    windowDays: effectiveWindowDays,
    windowStart: effectiveStart,
    windowEnd,
    show_rate:
      agg.bookings > 0 ? agg.shows / agg.bookings : null,
    close_rate:
      agg.shows > 0 ? agg.conversions / agg.shows : null,
    avg_revenue_per_conversion:
      agg.conversions > 0 ? agg.revenue / agg.conversions : null,
    bookingsInWindow: agg.bookings,
    showsInWindow: agg.shows,
    conversionsInWindow: agg.conversions,
  };
};

const _fetchProjectionRatesCached = unstable_cache(
  _fetchProjectionRatesRaw,
  ["projection-rates-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: ["daily-metrics"] },
);

export const fetchProjectionRates = cache(
  (clientId: string, windowEnd: string) =>
    _fetchProjectionRatesCached(clientId, windowEnd),
);

/** Inclusive day count between two yyyy-MM-dd strings. UTC-anchored
 *  so DST transitions inside the range don't off-by-one the result. */
function daysBetween(startStr: string, endStr: string): number {
  const start = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Applying the projection to an Aggregates object

export type ProjectionAdds = {
  /** outstanding count rolled forward (same as actuals.outstanding_appointments). */
  outstandingProjected: number;
  /** Counts the projection adds to each funnel stage. */
  addedShows: number;
  addedNoShows: number;
  addedConversions: number;
  addedRevenue: number;
  /** Rates that were applied. Echoed so callers can render an
   *  assumptions banner without re-passing rates separately. */
  rates: ProjectionRates;
};

/**
 * Compute what the projection ADDS to the given actuals. Returns the
 * deltas only — callers compose projected totals as
 * `actuals.field + adds.addedField`.
 *
 * Returns null when any required rate is missing (insufficient sample
 * size for a meaningful projection — e.g. no shows in the rate window).
 */
export function computeProjectionAdds(
  actuals: Aggregates,
  rates: ProjectionRates,
): ProjectionAdds | null {
  if (
    rates.show_rate === null ||
    rates.close_rate === null ||
    rates.avg_revenue_per_conversion === null
  ) {
    return null;
  }
  const outstanding = actuals.outstanding_appointments;
  const addedShows = outstanding * rates.show_rate;
  const addedNoShows = outstanding * (1 - rates.show_rate);
  const addedConversions = addedShows * rates.close_rate;
  const addedRevenue = addedConversions * rates.avg_revenue_per_conversion;

  return {
    outstandingProjected: outstanding,
    addedShows,
    addedNoShows,
    addedConversions,
    addedRevenue,
    rates,
  };
}

/**
 * Build a fully-projected Aggregates from actuals + adds. Re-derives
 * every ratio so consumers can read `projected.roas`, `projected.cpl`,
 * etc. directly without needing to know which fields project.
 *
 * Fields that don't project (leads, bookings, spend, link_clicks,
 * impressions, reach, meta_results) are passed through unchanged.
 * Cost-per-X metrics for projected stages (cost_per_show,
 * cost_per_conversion) recompute against the projected denominators.
 *
 * Outstanding drops to 0 — the projection's premise is that the
 * pipeline plays out, leaving nothing pending.
 */
export function projectAggregates(
  actuals: Aggregates,
  adds: ProjectionAdds,
): Aggregates {
  const shows = actuals.shows + adds.addedShows;
  const no_shows = actuals.no_shows + adds.addedNoShows;
  const conversions = actuals.conversions + adds.addedConversions;
  const revenue = actuals.revenue + adds.addedRevenue;
  const spend = actuals.spend; // unchanged
  const leads = actuals.leads;
  const bookings = actuals.bookings;

  const safeDiv = (n: number, d: number) => (d > 0 ? n / d : null);

  return {
    ...actuals,
    shows,
    no_shows,
    conversions,
    revenue,
    outstanding_appointments: 0,
    // Re-derive ratios. cpc/ctr/cpm/cpl/cost_per_booking unchanged
    // because their inputs are all spend-side or top-of-funnel.
    cost_per_show:       safeDiv(spend, shows),
    cost_per_conversion: safeDiv(spend, conversions),
    show_rate:           safeDiv(shows, bookings),
    lead_to_booking:     actuals.lead_to_booking,
    show_to_conversion:  safeDiv(conversions, shows),
    conversion_rate:     safeDiv(conversions, leads),
    avg_revenue_per_lead:       safeDiv(revenue, leads),
    avg_revenue_per_booking:    safeDiv(revenue, bookings),
    avg_revenue_per_show:       safeDiv(revenue, shows),
    avg_revenue_per_conversion: safeDiv(revenue, conversions),
    roas:                safeDiv(revenue, spend),
  };
}
