/**
 * Cost Efficiency + Revenue Efficiency strips.
 *
 * Computes both real AND projected variants of each item up front so
 * the EfficiencyClient can pick instantly based on the active view
 * mode. Items whose value actually differs between modes set
 * `projected: true` so the cell renders with a yellow underline.
 *
 * Which cells project:
 *   Cost per Lead       — no (spend + leads both unchanged)
 *   Cost per Booking    — no (spend + bookings both unchanged)
 *   Cost per Show       — yes (shows roll forward via outstanding × show_rate)
 *   Cost per Conversion — yes (conversions roll forward)
 *   Avg Rev per Lead    — yes (revenue projects, leads same)
 *   Avg Rev per Booking — yes (revenue projects, bookings same)
 *   Avg Rev per Show    — yes (both numerator + denominator shift)
 *   Avg Rev per Conv    — yes (weighted by projected vs actual mix)
 */
import { fetchDailyMetricsBothPeriods } from "@/lib/dashboard-data";
import { aggregate, pctChange } from "@/lib/metrics";
import { formatCurrency } from "@/lib/formatters";
import {
  fetchProjectionRates,
  computeProjectionAdds,
  projectAggregates,
} from "@/lib/projection";
import { EfficiencyClient } from "@/components/efficiency-client";
import type { EfficiencyItem } from "@/components/efficiency-strip";
import type { FunnelLabels } from "@/lib/auth";
import { pluralize } from "@/lib/funnel-labels";

type Props = {
  clientId: string;
  startStr: string;
  endStr: string;
  compStartStr: string;
  compEndStr: string;
  /** Per-client custom stage labels — drives the "Cost per X" /
   *  "Avg Rev per X" label text. */
  labels: FunnelLabels;
};

/** Whole-dollar above $100, two-decimals below. Matches what the old
 *  Revenue Efficiency formatting did — drops `$1,250.00` clutter on
 *  high-value cells and preserves precision on per-lead cells. */
function dollar(v: number | null, smallThreshold = 100): string | null {
  if (v === null) return null;
  return formatCurrency(v, v < smallThreshold ? 2 : 0);
}

export async function EfficiencySection({
  clientId,
  startStr,
  endStr,
  compStartStr,
  compEndStr,
  labels,
}: Props) {
  const [{ current, comparison }, rates] = await Promise.all([
    fetchDailyMetricsBothPeriods(clientId, startStr, endStr, compStartStr, compEndStr),
    fetchProjectionRates(clientId, endStr),
  ]);
  const agg = aggregate(current);
  const comp = aggregate(comparison);
  const adds = computeProjectionAdds(agg, rates);
  const proj = adds ? projectAggregates(agg, adds) : agg;

  // Empty-state hint helper. Pluralises the custom label via the
  // "add s after the first word" rule ("0 bookings", "0 quotes sent").
  // Lowercased so it blends with the "0 leads" / "0 conversions"
  // wording on the hardcoded stages.
  const customHint = (label: string) => `0 ${pluralize(label).toLowerCase()}`;

  // ── Cost Efficiency ─────────────────────────────────────────────────────
  // Real items.
  const costItems: EfficiencyItem[] = [
    {
      label: "Cost per Lead",
      value: agg.cpl !== null ? formatCurrency(agg.cpl, 2) : null,
      emptyHint: "0 leads",
      delta: pctChange(agg.cpl, comp.cpl),
      invertDelta: true,
    },
    {
      label: `Cost per ${labels.booking}`,
      value: agg.cost_per_booking !== null ? formatCurrency(agg.cost_per_booking, 2) : null,
      emptyHint: customHint(labels.booking),
      delta: pctChange(agg.cost_per_booking, comp.cost_per_booking),
      invertDelta: true,
    },
    {
      label: `Cost per ${labels.show}`,
      value: agg.cost_per_show !== null ? formatCurrency(agg.cost_per_show, 2) : null,
      emptyHint: customHint(labels.show),
      delta: pctChange(agg.cost_per_show, comp.cost_per_show),
      invertDelta: true,
    },
    {
      label: "Cost per Conversion",
      value: agg.cost_per_conversion !== null ? formatCurrency(agg.cost_per_conversion, 2) : null,
      emptyHint: "0 conversions",
      delta: pctChange(agg.cost_per_conversion, comp.cost_per_conversion),
      invertDelta: true,
    },
  ];

  // Projected variants — CPL + Cost-per-Booking are identical to real
  // (spend + leads + bookings don't project), so no underline. Cost-per-
  // Show and Cost-per-Conversion DO change (their denominators project).
  // Deltas show in projected mode too: the projected figure is treated like
  // any actual, so its delta is pctChange(projected, comparison period) — the
  // same prior-period comparison the real items use. CPL/Booking just spread
  // their real delta unchanged (their projected value equals the real one).
  const projectedCostItems: EfficiencyItem[] = [
    { ...costItems[0] }, // Cost/Lead — unchanged (delta same as real)
    { ...costItems[1] }, // Cost/Booking — unchanged
    {
      label: `Cost per ${labels.show}`,
      value: proj.cost_per_show !== null ? formatCurrency(proj.cost_per_show, 2) : null,
      emptyHint: customHint(labels.show),
      delta: pctChange(proj.cost_per_show, comp.cost_per_show),
      invertDelta: true,
      projected: true,
    },
    {
      label: "Cost per Conversion",
      value: proj.cost_per_conversion !== null ? formatCurrency(proj.cost_per_conversion, 2) : null,
      emptyHint: "0 conversions",
      delta: pctChange(proj.cost_per_conversion, comp.cost_per_conversion),
      invertDelta: true,
      projected: true,
    },
  ];

  // ── Revenue Efficiency ─────────────────────────────────────────────────
  const revenueItems: EfficiencyItem[] = [
    {
      label: "Avg Rev per Lead",
      value: dollar(agg.avg_revenue_per_lead),
      emptyHint: "0 leads",
      delta: pctChange(agg.avg_revenue_per_lead, comp.avg_revenue_per_lead),
    },
    {
      label: `Avg Rev per ${labels.booking}`,
      value: dollar(agg.avg_revenue_per_booking),
      emptyHint: customHint(labels.booking),
      delta: pctChange(agg.avg_revenue_per_booking, comp.avg_revenue_per_booking),
    },
    {
      label: `Avg Rev per ${labels.show}`,
      value: dollar(agg.avg_revenue_per_show),
      emptyHint: customHint(labels.show),
      delta: pctChange(agg.avg_revenue_per_show, comp.avg_revenue_per_show),
    },
    {
      label: "Avg Rev per Conversion",
      value: dollar(agg.avg_revenue_per_conversion),
      emptyHint: "0 conversions",
      delta: pctChange(agg.avg_revenue_per_conversion, comp.avg_revenue_per_conversion),
    },
  ];

  const projectedRevenueItems: EfficiencyItem[] = [
    {
      label: "Avg Rev per Lead",
      value: dollar(proj.avg_revenue_per_lead),
      emptyHint: "0 leads",
      delta: pctChange(proj.avg_revenue_per_lead, comp.avg_revenue_per_lead),
      projected: true,
    },
    {
      label: `Avg Rev per ${labels.booking}`,
      value: dollar(proj.avg_revenue_per_booking),
      emptyHint: customHint(labels.booking),
      delta: pctChange(proj.avg_revenue_per_booking, comp.avg_revenue_per_booking),
      projected: true,
    },
    {
      label: `Avg Rev per ${labels.show}`,
      value: dollar(proj.avg_revenue_per_show),
      emptyHint: customHint(labels.show),
      delta: pctChange(proj.avg_revenue_per_show, comp.avg_revenue_per_show),
      projected: true,
    },
    {
      label: "Avg Rev per Conversion",
      value: dollar(proj.avg_revenue_per_conversion),
      emptyHint: "0 conversions",
      delta: pctChange(proj.avg_revenue_per_conversion, comp.avg_revenue_per_conversion),
      projected: true,
    },
  ];

  return (
    <EfficiencyClient
      costItems={costItems}
      revenueItems={revenueItems}
      projectedCostItems={projectedCostItems}
      projectedRevenueItems={projectedRevenueItems}
      canProject={adds !== null}
    />
  );
}
