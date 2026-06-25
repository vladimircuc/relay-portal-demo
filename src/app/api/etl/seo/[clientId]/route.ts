/**
 * GET /api/etl/seo/[clientId]
 *
 * Manual trigger for one client's SEO pull (GSC + GA4 + Bing → Postgres).
 * Same auth as the other ETL routes: Bearer CRON_SECRET or a super-admin
 * session (requireEtlAccess). Wrapped in withEtlRun so it logs to etl_runs +
 * busts the seo-series cache, exactly like the nightly cron will.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/etl/seo/<clientId>
 *
 * Long external pulls belong in a Node route (not a server action) per the
 * conventions doc. The nightly cron calls runSeoDailyPull directly via its own
 * withEtlRun wrapper; this route is for on-demand backfills + testing.
 */
import { withEtlRun } from "@/lib/etl/runs";
import { requireEtlAccess } from "@/lib/etl/auth";
import { runSeoDailyPull } from "@/lib/etl/seo";

export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  // Web & SEO local super-admins can run the backfill for their client (not just
  // global super-admins) — same "web" scope that gates the SEO settings actions.
  const auth = await requireEtlAccess(request, { clientId, capability: "web" });
  if (!auth.ok) return auth.response;

  // On-demand = a FULL backfill: paginates the entire keyword history into
  // seo_query_daily (the nightly cron only refreshes the recent window).
  const outcome = await withEtlRun({ clientId, source: "seo_daily", clientSlug: clientId }, () =>
    runSeoDailyPull({ clientId, full: true }),
  );

  return new Response(JSON.stringify(outcome, null, 2), {
    status: outcome.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}
