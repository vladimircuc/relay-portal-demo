/**
 * Aggregates and derived metrics computed over a set of daily rows.
 * All ratios are computed as totals (sum / sum), never as averages of daily
 * ratios — that's the bug we removed from the original sheet.
 */

import { safeDiv } from "./formatters";
import type { DailyMetricsRow } from "./types";

export type Aggregates = {
  // Base sums (matching daily_metrics_v)
  spend: number;
  impressions: number;
  link_clicks: number;
  reach: number;
  leads: number;
  bookings: number;
  no_shows: number;
  shows: number;
  conversions: number;
  revenue: number;
  meta_results: number;
  days: number;
  /**
   * Bookings that haven't yet resolved into a no-show or a show. With the
   * cumulative phase membership we use today (`bookings` includes every
   * stage past the start of the funnel), opps currently sitting in the
   * literal "Booked" stage are the ones still outstanding. The math:
   *   outstanding = bookings − no_shows − shows
   * Important for clients with long sales cycles (Varble, orthodontics —
   * a booking can sit for weeks before the appointment).
   */
  outstanding_appointments: number;
  // Derived (null when undefined / division by zero)
  cpc: number | null;
  ctr: number | null;
  cpm: number | null;
  cpl: number | null;
  cost_per_booking: number | null;
  cost_per_show: number | null;
  cost_per_conversion: number | null;
  show_rate: number | null;            // shows / bookings
  lead_to_booking: number | null;       // bookings / leads
  show_to_conversion: number | null;    // conversions / shows (sales-close rate)
  // Industry-standard "conversion rate": conversions / leads (Meta/Google convention).
  // NOT conversions / shows — that's a sales-closing rate, a different metric.
  conversion_rate: number | null;
  // Revenue side per pipeline stage — what is one X worth on average?
  // Pairs visually with cost_per_X in the dashboard: "Revenue Efficiency"
  // mirrors "Cost Efficiency" so a client reads cost-in (top strip) and
  // revenue-out (bottom strip) per stage side by side. All are revenue/X,
  // null when X is 0.
  avg_revenue_per_lead: number | null;
  avg_revenue_per_booking: number | null;
  avg_revenue_per_show: number | null;
  avg_revenue_per_conversion: number | null;
  roas: number | null;                  // revenue / spend
};

export function aggregate(rows: DailyMetricsRow[]): Aggregates {
  const sum = (k: keyof DailyMetricsRow) =>
    rows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);

  const spend = sum("spend");
  const impressions = sum("impressions");
  const link_clicks = sum("link_clicks");
  const reach = sum("reach");
  const leads = sum("leads");
  const bookings = sum("bookings");
  const no_shows = sum("no_shows");
  const shows = sum("shows");
  const conversions = sum("conversions");
  const revenue = sum("revenue");
  const meta_results = sum("meta_results");

  // Outstanding = bookings - no_shows - shows. Cannot go below 0 in
  // theory (cumulative phase membership invariant), but clamp just in
  // case a client has weird stage mappings that violate the invariant.
  const outstanding_appointments = Math.max(0, bookings - no_shows - shows);

  return {
    spend, impressions, link_clicks, reach,
    leads, bookings, no_shows, shows, conversions, revenue, meta_results,
    days: rows.length,
    outstanding_appointments,
    cpc: safeDiv(spend, link_clicks),
    ctr: safeDiv(link_clicks, impressions),
    cpm: safeDiv(spend * 1000, impressions),
    cpl: safeDiv(spend, leads),
    cost_per_booking:    safeDiv(spend, bookings),
    cost_per_show:       safeDiv(spend, shows),
    cost_per_conversion: safeDiv(spend, conversions),
    show_rate:           safeDiv(shows, bookings),
    lead_to_booking:     safeDiv(bookings, leads),
    show_to_conversion:  safeDiv(conversions, shows),
    // Industry-standard "conversion rate": of all top-of-funnel leads, what
    // share became customers. This is the headline marketing KPI clients
    // see from Meta / Google / HubSpot, so we use the same definition.
    // (The show→conversion ratio is `show_to_conversion` above —
    // a sales-closing rate, useful but a different metric.)
    conversion_rate:     safeDiv(conversions, leads),
    avg_revenue_per_lead:       safeDiv(revenue, leads),
    avg_revenue_per_booking:    safeDiv(revenue, bookings),
    avg_revenue_per_show:       safeDiv(revenue, shows),
    avg_revenue_per_conversion: safeDiv(revenue, conversions),
    roas:                safeDiv(revenue, spend),
  };
}

/** Percent change from `previous` to `current`. Null if previous is 0/missing. */
export function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}
