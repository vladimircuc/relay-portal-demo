/**
 * Hero stats — Spend → Revenue = ROAS.
 *
 * Computes BOTH real and projected triples server-side and hands them
 * to the HeroStats client component, which picks which to display based
 * on the active view mode. This way toggling Real ↔ Projected is a pure
 * re-render — no extra fetch.
 *
 * `fetchProjectionRates` is shared via React `cache()`, so the Funnel /
 * Source / Efficiency sections that also need it on this page all
 * share one DB roundtrip.
 */
import { fetchDailyMetricsBothPeriods } from "@/lib/dashboard-data";
import { aggregate, pctChange } from "@/lib/metrics";
import {
  fetchProjectionRates,
  computeProjectionAdds,
  projectAggregates,
} from "@/lib/projection";
import { HeroStats } from "@/components/hero-stats";

type Props = {
  clientId: string;
  startStr: string;
  endStr: string;
  compStartStr: string;
  compEndStr: string;
};

export async function HeroSection({ clientId, startStr, endStr, compStartStr, compEndStr }: Props) {
  const [{ current, comparison }, rates] = await Promise.all([
    fetchDailyMetricsBothPeriods(clientId, startStr, endStr, compStartStr, compEndStr),
    fetchProjectionRates(clientId, endStr),
  ]);
  const agg = aggregate(current);
  const comp = aggregate(comparison);

  // Pre-compute the projected triple so HeroStats just picks. If we
  // can't project (insufficient rate sample) fall back to actuals —
  // the ProjectionBanner explains why in that case, and HeroStats's
  // `canProject` flag tells it not to decorate.
  const adds = computeProjectionAdds(agg, rates);
  const projected = adds ? projectAggregates(agg, adds) : agg;

  return (
    <HeroStats
      real={{ spend: agg.spend, revenue: agg.revenue, roas: agg.roas }}
      projected={{ spend: projected.spend, revenue: projected.revenue, roas: projected.roas }}
      canProject={adds !== null}
      spendDelta={pctChange(agg.spend, comp.spend)}
      revenueDelta={pctChange(agg.revenue, comp.revenue)}
      roasDelta={pctChange(agg.roas, comp.roas)}
      // Projected-mode deltas: the projected figure compared to the prior
      // period actual (same baseline the real deltas use). Spend doesn't
      // project, so its projected delta equals the real one — no separate prop.
      projectedRevenueDelta={pctChange(projected.revenue, comp.revenue)}
      projectedRoasDelta={pctChange(projected.roas, comp.roas)}
    />
  );
}
