/**
 * Server wrapper around the ProjectionBanner client component.
 *
 * Fetches the current period's totals (just to read the outstanding
 * count) + the stabilised projection rates, then hands both to
 * <ProjectionBanner />. The banner itself is a Client Component that
 * checks viewMode and renders nothing when in real mode.
 *
 * Both fetchers (fetchDailyMetrics + fetchProjectionRates) are wrapped
 * in React `cache()`, so this section shares its DB roundtrips with
 * Hero / Funnel / Source / Efficiency on the same page — no extra
 * cost added by the banner.
 */
import { fetchDailyMetrics } from "@/lib/dashboard-data";
import { aggregate } from "@/lib/metrics";
import { fetchProjectionRates } from "@/lib/projection";
import { ProjectionBanner } from "@/components/projection-banner";
import type { FunnelLabels } from "@/lib/auth";

type Props = {
  clientId: string;
  startStr: string;
  endStr: string;
  labels: FunnelLabels;
};

export async function ProjectionBannerSection({ clientId, startStr, endStr, labels }: Props) {
  const [current, rates] = await Promise.all([
    fetchDailyMetrics(clientId, startStr, endStr),
    fetchProjectionRates(clientId, endStr),
  ]);
  const agg = aggregate(current);
  return (
    <ProjectionBanner
      outstanding={agg.outstanding_appointments}
      rates={rates}
      labels={labels}
    />
  );
}
