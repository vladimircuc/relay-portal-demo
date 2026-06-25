/**
 * Pipeline funnel — server fetches BOTH the current actuals AND the
 * projected variant up front, then hands both to the <Funnel/> client
 * component which picks one based on the active view mode.
 *
 * The projection rolls outstanding × historical show_rate × close_rate
 * forward into the shows + conversions stages and drops outstanding
 * to 0. See lib/projection.ts for the math.
 *
 * Optional `goals` come from the client's row in `clients` (set in
 * /admin). Goal pills compare against the displayed stage rates
 * regardless of mode — in projected mode, the rates reflect the
 * pipeline's projected play-out.
 */
import { fetchDailyMetricsBothPeriods } from "@/lib/dashboard-data";
import { aggregate, pctChange } from "@/lib/metrics";
import {
  fetchProjectionRates,
  computeProjectionAdds,
  projectAggregates,
} from "@/lib/projection";
import { Funnel, type FunnelGoals } from "@/components/funnel";
import type { FunnelLabels } from "@/lib/auth";

type Props = {
  clientId: string;
  startStr: string;
  endStr: string;
  compStartStr: string;
  compEndStr: string;
  goals?: FunnelGoals;
  labels: FunnelLabels;
};

export async function FunnelSection({ clientId, startStr, endStr, compStartStr, compEndStr, goals, labels }: Props) {
  const [{ current, comparison }, rates] = await Promise.all([
    fetchDailyMetricsBothPeriods(clientId, startStr, endStr, compStartStr, compEndStr),
    fetchProjectionRates(clientId, endStr),
  ]);
  const agg = aggregate(current);
  const comp = aggregate(comparison);
  // Week-over-week change in top-of-funnel leads (vs the prior period), shown as
  // a delta pill on the Leads stage — same convention as the hero/CPL deltas.
  const leadsDelta = pctChange(agg.leads, comp.leads);

  // Compute the projected counts up front. When projection isn't
  // possible (sample too thin), fall back to actuals; the banner
  // surfaces why. The Funnel component just renders whatever it's
  // given for the active mode.
  const adds = computeProjectionAdds(agg, rates);
  const projected = adds ? projectAggregates(agg, adds) : agg;

  return (
    <Funnel
      real={{
        leads: agg.leads,
        bookings: agg.bookings,
        shows: agg.shows,
        conversions: agg.conversions,
        outstanding: agg.outstanding_appointments,
        no_shows: agg.no_shows,
      }}
      projected={{
        leads: projected.leads,
        bookings: projected.bookings,
        shows: projected.shows,
        conversions: projected.conversions,
        outstanding: projected.outstanding_appointments,
        no_shows: projected.no_shows,
      }}
      canProject={adds !== null}
      leadsDelta={leadsDelta}
      goals={goals}
      labels={labels}
    />
  );
}
