/**
 * Ad-performance row (CTR / CPC / CPM with daily sparklines). Advanced-only.
 */
import { fetchDailyMetricsBothPeriods } from "@/lib/dashboard-data";
import { aggregate, pctChange } from "@/lib/metrics";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { PerformanceRow } from "@/components/performance-row";

type Props = {
  clientId: string;
  startStr: string;
  endStr: string;
  compStartStr: string;
  compEndStr: string;
};

export async function PerformanceSection({
  clientId,
  startStr,
  endStr,
  compStartStr,
  compEndStr,
}: Props) {
  const { current, comparison } = await fetchDailyMetricsBothPeriods(
    clientId, startStr, endStr, compStartStr, compEndStr,
  );
  const agg = aggregate(current);
  const comp = aggregate(comparison);

  // Per-day series for the sparklines + their hover tooltips. Pairing
  // each value with its day lets the tooltip surface "Mar 14: $4.20"
  // rather than just a bare number.
  //
  // Compute each metric the same way aggregate() does — from base
  // counts, not from Meta's pre-aggregated cpm/cpc/ctr columns. Two
  // reasons:
  //   (1) Scale: meta_daily.ctr is stored as a percent NUMBER (e.g.
  //       1.55 = 1.55%) because Meta returns it that way, but
  //       formatPercent (used by the sparkline tooltip via the
  //       "percent" unit) multiplies by 100 — so feeding it the raw
  //       value showed "155%" on a 1.55% day, "291.60%" on a 2.92%
  //       day, etc. Computing as link_clicks/impressions gives the
  //       decimal (0.0155) the formatter expects.
  //   (2) Definition: Meta's "ctr" is CTR (all) = any clicks /
  //       impressions, while the headline uses link_clicks /
  //       impressions. Same goes for cpc (Meta's includes all
  //       click types). Computing locally keeps the sparkline hover
  //       value's definition aligned with the headline number above
  //       it, so they don't drift apart.
  //
  // Days with no impressions / clicks / spend contribute 0 — same
  // semantics as the aggregate's safeDiv fallback.
  const ctrSeries = current.map((r) => ({
    day: r.day,
    value: r.impressions > 0 ? r.link_clicks / r.impressions : 0,
  }));
  const cpcSeries = current.map((r) => ({
    day: r.day,
    value: r.link_clicks > 0 ? r.spend / r.link_clicks : 0,
  }));
  const cpmSeries = current.map((r) => ({
    day: r.day,
    value: r.impressions > 0 ? (r.spend * 1000) / r.impressions : 0,
  }));

  // `unit` is a serializable string discriminator — must NOT be a
  // formatter function here, since this server component renders into
  // a tree that eventually reaches the Sparkline client component.
  // Next.js rejects functions crossing the server→client boundary.
  const items = [
    {
      label: "CTR",
      value: formatPercent(agg.ctr, 2),
      delta: pctChange(agg.ctr, comp.ctr),
      series: ctrSeries,
      unit: "percent" as const,
    },
    {
      label: "CPC",
      value: agg.cpc !== null ? formatCurrency(agg.cpc, 2) : "—",
      delta: pctChange(agg.cpc, comp.cpc),
      invertDelta: true,
      series: cpcSeries,
      unit: "currency" as const,
    },
    {
      label: "CPM",
      value: agg.cpm !== null ? formatCurrency(agg.cpm, 2) : "—",
      delta: pctChange(agg.cpm, comp.cpm),
      invertDelta: true,
      series: cpmSeries,
      unit: "currency" as const,
    },
  ];

  return <PerformanceRow items={items} />;
}
