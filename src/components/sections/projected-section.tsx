/**
 * Projected (annualized) row — extrapolates the current period to 365 days.
 * Advanced-only.
 */
import { fetchDailyMetrics } from "@/lib/dashboard-data";
import { aggregate } from "@/lib/metrics";
import { ProjectedCard } from "@/components/projected-card";
import type { FunnelLabels } from "@/lib/auth";

type Props = {
  clientId: string;
  startStr: string;
  endStr: string;
  labels: FunnelLabels;
};

export async function ProjectedSection({ clientId, startStr, endStr, labels }: Props) {
  const current = await fetchDailyMetrics(clientId, startStr, endStr);
  const agg = aggregate(current);

  return (
    <ProjectedCard
      days={agg.days}
      leads={agg.leads}
      bookings={agg.bookings}
      conversions={agg.conversions}
      revenue={agg.revenue}
      labels={labels}
    />
  );
}
