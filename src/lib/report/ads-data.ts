/**
 * Gather the Ads page's live numbers for a client + date range. Reuses the
 * dashboard's own fetcher and the same comparison-period math the /ads page
 * uses (prior equal-length window ending the day before `start`), so the
 * report matches the live dashboard exactly.
 */
import { format, subDays, differenceInCalendarDays } from "date-fns";
import { fetchDailyMetricsBothPeriods } from "@/lib/dashboard-data";
import { pluralize } from "@/lib/funnel-labels";
import type { ResolvedClient } from "@/lib/auth";
import type { AdsData } from "./templates";

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

type Totals = {
  spend: number;
  revenue: number;
  leads: number;
  bookings: number;
  shows: number;
  conversions: number;
};

function sum(rows: Array<Record<string, unknown>>): Totals {
  const acc: Totals = { spend: 0, revenue: 0, leads: 0, bookings: 0, shows: 0, conversions: 0 };
  for (const r of rows) {
    acc.spend += Number(r.spend) || 0;
    acc.revenue += Number(r.revenue) || 0;
    acc.leads += Number(r.leads) || 0;
    acc.bookings += Number(r.bookings) || 0;
    acc.shows += Number(r.shows) || 0;
    acc.conversions += Number(r.conversions) || 0;
  }
  return acc;
}

const div = (a: number, b: number) => (b ? a / b : NaN);
/** fractional change, or null when it isn't meaningful (no prior value). */
function delta(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return (cur - prev) / prev;
}

export async function gatherAdsData(
  client: ResolvedClient,
  startStr: string,
  endStr: string,
): Promise<AdsData> {
  const start = parseLocal(startStr);
  const end = parseLocal(endStr);
  const lenDays = differenceInCalendarDays(end, start) + 1;
  const compEnd = subDays(start, 1);
  const compStart = subDays(compEnd, lenDays - 1);

  const { current, comparison } = await fetchDailyMetricsBothPeriods(
    client.id,
    startStr,
    endStr,
    format(compStart, "yyyy-MM-dd"),
    format(compEnd, "yyyy-MM-dd"),
  );

  const cur = sum(current as Array<Record<string, unknown>>);
  const prev = sum(comparison as Array<Record<string, unknown>>);

  const roas = div(cur.revenue, cur.spend);
  const cpl = div(cur.spend, cur.leads);
  const cpc = div(cur.spend, cur.conversions);

  return {
    spend: cur.spend,
    revenue: cur.revenue,
    roas,
    leads: cur.leads,
    costPerLead: cpl,
    conversions: cur.conversions,
    costPerConversion: cpc,
    deltas: {
      spend: delta(cur.spend, prev.spend),
      revenue: delta(cur.revenue, prev.revenue),
      roas: delta(roas, div(prev.revenue, prev.spend)),
      leads: delta(cur.leads, prev.leads),
      costPerLead: delta(cpl, div(prev.spend, prev.leads)),
      conversions: delta(cur.conversions, prev.conversions),
      costPerConversion: delta(cpc, div(prev.spend, prev.conversions)),
    },
    funnel: {
      leads: cur.leads,
      bookingLabel: pluralize(client.funnel_labels.booking),
      bookings: cur.bookings,
      showLabel: pluralize(client.funnel_labels.show),
      shows: cur.shows,
      conversions: cur.conversions,
    },
  };
}

/** Period label helpers shared by the route. */
export function rangeLabel(startStr: string, endStr: string): string {
  const a = parseLocal(startStr);
  const b = parseLocal(endStr);
  const sameYear = a.getFullYear() === b.getFullYear();
  return `${format(a, sameYear ? "MMM d" : "MMM d, yyyy")} – ${format(b, "MMM d, yyyy")}`;
}
export function priorRangeLabel(startStr: string, endStr: string): string {
  const start = parseLocal(startStr);
  const end = parseLocal(endStr);
  const lenDays = differenceInCalendarDays(end, start) + 1;
  const compEnd = subDays(start, 1);
  const compStart = subDays(compEnd, lenDays - 1);
  return rangeLabel(format(compStart, "yyyy-MM-dd"), format(compEnd, "yyyy-MM-dd"));
}
