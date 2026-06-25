/**
 * Async server component — fetches Asera opportunities for the period and
 * aggregates them into source-breakdown buckets. Renders the client-side
 * SourceBreakdown which holds its own Leads / Revenue / ROAS toggle.
 *
 * Three metric definitions that the client toggles between:
 *   - Leads:   total opps in the period (matches Hero `leads`).
 *   - Revenue: monetary_value sum across converted-stage opps PLUS the
 *              per-show surcharge (revenue_per_show × showed opps), attributed
 *              to each opp's source. This mirrors daily_metrics_v exactly:
 *                revenue = sum(monetary_value on converted) + rev_per_show × shows
 *              so the donut total equals the Hero `revenue` figure. The
 *              surcharge term is 0 for every client with revenue_per_show=0.
 *   - ROAS:    revenue / allocated_spend per source. Advanced tier only
 *              (the toggle option is hidden on Simple).
 *
 * Spend per source — the missing piece for ROAS — isn't stored in our
 * DB (Meta ETL aggregates daily spend, not per-ad). We approximate by
 * allocating total period spend across sources proportionally to each
 * source's share of leads:
 *
 *   spend_per_source = total_spend × leads_per_source / total_leads
 *
 * Imperfect (assumes every lead costs the same to acquire regardless
 * of source) but the best we can do without ETL changes. Surfaces
 * directionally useful "this source brings in $X for ~$Y of spend"
 * insights for the agency.
 *
 * Projection (Real-vs-Projected toggle):
 *   - leadBuckets don't project (top of funnel, unchanged).
 *   - revenueBuckets has two versions: actual closed-only revenue, and
 *     projected = actual + outstanding-per-source × show_rate × close_rate
 *     × avg_revenue_per_conversion.
 *   - ROAS buckets follow the same pattern: real_roas vs projected_roas
 *     (spend per source stays constant — spend doesn't project).
 */
import {
  fetchOppsInPeriod,
  fetchConvertedStageIds,
  fetchPhaseStageIds,
  fetchDailyMetrics,
  fetchLostOppsInPeriod,
  fetchLostReasonMap,
} from "@/lib/dashboard-data";
import { aggregateSources, type SourceBucket } from "@/lib/sources";
import { aggregateLostReasons, lostReasonsEnabled } from "@/lib/lost-reasons";
import { aggregate } from "@/lib/metrics";
import { fetchProjectionRates } from "@/lib/projection";
import { SourceBreakdown } from "@/components/source-breakdown";

type Props = {
  clientId: string;
  /** Client slug — drives the per-client "Lost" tab feature gate. */
  clientSlug: string;
  timezone: string;
  /** Calendar date strings — passed straight through to the fetcher, no
      ISO/Date round-trip (which previously shifted the boundary by a day
      in the user's TZ and caused a 94-vs-97 mismatch with the funnel). */
  startStr: string;
  endStr: string;
  /** Flat $/show consult fee (clients.revenue_per_show). Folded into the
      Revenue donut the same way daily_metrics_v folds it into Hero revenue,
      so the two figures agree. 0 for clients without an intro-consult fee. */
  revenuePerShow: number;
  /** clients.ads_meta_source_only. When true (default), the donut drops
      non-Meta-sourced opps so it matches the Meta-filtered Hero/funnel. The
      SQL view applies the same gate to the funnel numbers (migration 031). */
  metaOnly: boolean;
};

export async function SourceSection({
  clientId,
  clientSlug,
  timezone,
  startStr,
  endStr,
  revenuePerShow,
  metaOnly,
}: Props) {
  const [periodOpps, convertedStageIds, phases, rates, daily] = await Promise.all([
    fetchOppsInPeriod(clientId, timezone, startStr, endStr, metaOnly),
    fetchConvertedStageIds(clientId),
    fetchPhaseStageIds(clientId),
    fetchProjectionRates(clientId, endStr),
    fetchDailyMetrics(clientId, startStr, endStr),
  ]);

  const periodTotals = aggregate(daily);
  const totalSpend = periodTotals.spend;

  // ── Leads ────────────────────────────────────────────────────────────────
  const leadBuckets = aggregateSources(periodOpps, {
    mode: "count",
    maxSlices: 6,
    minShare: 0.04,
  });
  // Total leads = sum of leadBucket values. Used as the denominator for
  // spend allocation per source.
  const totalLeads = leadBuckets.reduce((acc, b) => acc + b.value, 0);

  // Map: bucket label → leads count. We allocate spend by lead share, so
  // matching the revenue buckets (which use the same labels) is enough.
  // "Other" rolls up multiple small sources but its lead share is well-
  // defined as the sum of its rolled-up sources' shares.
  const leadsByLabel = new Map<string, number>();
  for (const b of leadBuckets) leadsByLabel.set(b.label, b.value);

  // ── Real revenue ─────────────────────────────────────────────────────────
  const convertedSet = new Set(convertedStageIds);
  const showedSet = new Set(phases.showed);
  // Converted-stage opps whose deal is still real (open/won). An opp dragged
  // into a converted stage but later abandoned/lost is not revenue — mirrors
  // the Hero's SQL gate `lower(status) in ('open','won')` (migration 032). The
  // per-show surcharge below is intentionally NOT status-gated: a showed-but-
  // abandoned opp still earns its $/show, exactly as count_opps_for_phase
  // ('showed') is unaffected by the converted-only status clause.
  const convertedOpps = periodOpps.filter(
    (o) =>
      o.pipeline_stage_id !== null &&
      convertedSet.has(o.pipeline_stage_id) &&
      ["open", "won"].includes((o.status ?? "").toLowerCase()),
  );

  // Per-show surcharge: a flat consult fee charged on every held appointment
  // (e.g. St. Louis Sports Clinic, $67/show). daily_metrics_v computes revenue
  // as `sum(monetary_value on converted) + revenue_per_show × shows`, so the
  // Hero card includes this surcharge. We add the same term here — one
  // `revenuePerShow` contribution per showed opp, keyed to that opp's source —
  // or the donut total falls short of Hero by exactly revenue_per_show × shows.
  // Uses the SAME showed-phase stage ids the SQL count_opps_for_phase('showed')
  // uses, so it agrees with Hero whether or not the client's phases are
  // cumulative. No-op (empty) for the ~9 clients with revenue_per_show=0.
  const surchargeOpps =
    revenuePerShow > 0
      ? periodOpps
          .filter((o) => o.pipeline_stage_id !== null && showedSet.has(o.pipeline_stage_id))
          .map((o) => ({ source: o.source, monetary_value: revenuePerShow }))
      : [];

  const realRevenueBuckets = aggregateSources([...convertedOpps, ...surchargeOpps], {
    mode: "revenue",
    maxSlices: 6,
    minShare: 0.04,
  });

  // ── Projected revenue ────────────────────────────────────────────────────
  const bookedSet = new Set(phases.booked);
  const noShowSet = new Set(phases.no_show);
  // showedSet defined above (shared with the per-show surcharge).
  const stillOutstanding = (stageId: string | null): boolean => {
    if (!stageId) return false;
    if (!bookedSet.has(stageId)) return false;
    if (noShowSet.has(stageId)) return false;
    if (showedSet.has(stageId)) return false;
    if (convertedSet.has(stageId)) return false;
    return true;
  };

  const canProject =
    rates.show_rate !== null &&
    rates.close_rate !== null &&
    rates.avg_revenue_per_conversion !== null;

  let projectedRevenueBuckets = realRevenueBuckets;
  if (canProject) {
    const expectedRevPerOutstanding =
      (rates.show_rate as number) *
      (rates.close_rate as number) *
      (rates.avg_revenue_per_conversion as number);
    const projectedOpps = [
      ...convertedOpps,
      // Same per-show surcharge as Real mode — Hero's projected revenue is
      // `actuals.revenue (which already includes rev_per_show × shows) + adds`,
      // so the surcharge carries into projected unchanged.
      ...surchargeOpps,
      ...periodOpps
        .filter((o) => stillOutstanding(o.pipeline_stage_id))
        .map((o) => ({
          source: o.source,
          monetary_value: expectedRevPerOutstanding,
          pipeline_stage_id: o.pipeline_stage_id,
        })),
    ];
    projectedRevenueBuckets = aggregateSources(projectedOpps, {
      mode: "revenue",
      maxSlices: 6,
      minShare: 0.04,
    });
  }

  // ── ROAS ─────────────────────────────────────────────────────────────────
  // For each revenue bucket, lookup its lead share via the labels map,
  // allocate spend proportionally, then compute ROAS = revenue / spend.
  // Bucket order preserved so revenue and ROAS arrays match index-for-
  // index — the donut sizes by revenue, the list shows ROAS multipliers.
  const computeRoasBucket = (b: SourceBucket): SourceBucket => {
    const leadsForLabel = leadsByLabel.get(b.label) ?? 0;
    const leadShare = totalLeads > 0 ? leadsForLabel / totalLeads : 0;
    const allocatedSpend = totalSpend * leadShare;
    const roas = allocatedSpend > 0 ? b.value / allocatedSpend : 0;
    return { ...b, value: roas };
  };
  const realRoasBuckets = realRevenueBuckets.map(computeRoasBucket);
  const projectedRoasBuckets = projectedRevenueBuckets.map(computeRoasBucket);

  // ── Lost reasons (opt-in, per-client) ─────────────────────────────────────
  // Only fetch when the client is allowlisted (lib/lost-reasons.ts) — keeps the
  // extra DB read + the (cached) GHL reason-map call off everyone else's path.
  const lostEnabled = lostReasonsEnabled(clientSlug);
  let lostBuckets: SourceBucket[] = [];
  if (lostEnabled) {
    const [lostOpps, reasonList] = await Promise.all([
      fetchLostOppsInPeriod(clientId, timezone, startStr, endStr, metaOnly),
      fetchLostReasonMap(clientId),
    ]);
    const reasonNames = new Map(reasonList.map((r) => [r.id, r.name]));
    lostBuckets = aggregateLostReasons(lostOpps, reasonNames);
  }

  return (
    <SourceBreakdown
      leadBuckets={leadBuckets}
      revenueBuckets={realRevenueBuckets}
      projectedRevenueBuckets={projectedRevenueBuckets}
      roasBuckets={realRoasBuckets}
      projectedRoasBuckets={projectedRoasBuckets}
      totalSpend={totalSpend}
      canProject={canProject}
      lostBuckets={lostBuckets}
      lostEnabled={lostEnabled}
    />
  );
}
