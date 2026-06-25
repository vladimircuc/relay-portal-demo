/**
 * GET /api/etl/seo-grid/[clientId]
 *
 * Manual trigger for one client's Local Search Grid read (BrightLocal geo-grid
 * → Postgres). SEPARATE from /api/etl/seo/[clientId] (the GSC/GA4/Bing pull) so
 * the heavier search backfill and the lightweight grid read run independently.
 * Same auth as every ETL route: Bearer CRON_SECRET or a super-admin session.
 *
 * `full` backfill also walks each keyword's historical run list to seed the
 * avg-rank-over-time trend; the nightly cron calls runLocalGridPull (full=false)
 * and just appends the latest run. READ-only — never starts a (paid) grid run.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/etl/seo-grid/<clientId>
 */
import { withEtlRun } from "@/lib/etl/runs";
import { requireEtlAccess } from "@/lib/etl/auth";
import { runLocalGridPull } from "@/lib/etl/seo-local-grid";

export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  // Web & SEO local super-admins can run the local-grid backfill for their client.
  const auth = await requireEtlAccess(request, { clientId, capability: "web" });
  if (!auth.ok) return auth.response;

  const outcome = await withEtlRun({ clientId, source: "seo_local_grid", clientSlug: clientId }, () =>
    runLocalGridPull({ clientId, full: true }),
  );

  return new Response(JSON.stringify(outcome, null, 2), {
    status: outcome.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
}
