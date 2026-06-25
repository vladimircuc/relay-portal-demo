/**
 * GET /api/seo-grid/point/[clientId]?keywordId=&pointId=
 *
 * On-demand "who ranks here" detail for ONE grid point — powers the map's
 * click popup (top 3 businesses at that point + the client's own rank). Read
 * live from BrightLocal (free) rather than pre-stored, since per-point data is
 * 25–49 rows per keyword and only needed on click.
 *
 * CLIENT-FACING: unlike the ETL routes (super-admin / CRON only), a client_user
 * viewing their own dashboard must be able to call this. We therefore:
 *   1. auth the viewer the same way the /seo page does (super-admin / admin can
 *      see any client; a client_user only their own), and
 *   2. resolve report_id + run_id SERVER-SIDE from the client's stored grid, so
 *      the endpoint can only read points we already show for this client — never
 *      an arbitrary BrightLocal report.
 */
import { getCurrentUser, resolveAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { withBrightLocal, getLsgPointResults } from "@/lib/etl/brightlocal";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const url = new URL(request.url);
  const keywordId = url.searchParams.get("keywordId");
  const pointId = url.searchParams.get("pointId");
  if (!keywordId || !pointId) return json(400, { error: "keywordId and pointId are required" });

  const user = await getCurrentUser();
  if (!user?.email) return json(401, { error: "unauthorized" });
  const access = await resolveAccess(user.email);
  const canView =
    access.kind === "super_admin" || access.kind === "admin"
      ? true
      : access.kind === "client_user" && access.client.id === clientId;
  if (!canView) return json(403, { error: "forbidden" });

  // Resolve the report + run from THIS client's stored grid (scopes the lookup).
  const sb = createAdminClient();
  const { data: row } = await sb
    .from("seo_local_grid")
    .select("report_id, run_id")
    .eq("client_id", clientId)
    .eq("keyword_id", keywordId)
    .maybeSingle();
  const grid = row as { report_id?: number; run_id?: number } | null;
  if (!grid?.report_id || !grid?.run_id) return json(404, { error: "no grid for that keyword" });

  try {
    const { items } = await withBrightLocal((call) =>
      getLsgPointResults(call, grid.report_id!, grid.run_id!, keywordId, pointId),
    );
    const businesses = (items ?? []).map((b) => ({
      rank: b.rank,
      name: b.name,
      reviews: b.num_reviews ?? null,
      rating: b.review_rating ?? null,
      isClient: !!b.is_customer_business,
    }));
    return json(200, { businesses });
  } catch (e) {
    // Don't reflect raw upstream/infra error text to the caller — log it with a
    // correlation id the operator can grep for instead.
    const errorId = crypto.randomUUID();
    console.error(`[seo-grid/point] failed (errorId=${errorId})`, e);
    return json(502, { error: "Upstream lookup failed", errorId });
  }
}
