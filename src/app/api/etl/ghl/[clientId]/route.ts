/**
 * POST /api/etl/ghl/[clientId]
 *
 * Triggers a full GHL opportunities sweep for one client. No date range
 * params — GHL doesn't expose a "delta since X" filter on the search
 * endpoint, so we always re-paginate everything and upsert by ghl_id.
 *
 * Authorization: Vercel cron (Bearer CRON_SECRET) OR super-admin session.
 *
 * Response: same shape as the Meta route.
 *
 * Heads-up: this can take 30-60 seconds for a client with thousands of
 * opportunities (1.5s pause between pages × N pages). If you hit the
 * maxDuration ceiling, either upgrade to Pro (300s) or split GHL pulls
 * across multiple invocations.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { runGhlPull } from "@/lib/etl/ghl";
import { withEtlRun } from "@/lib/etl/runs";
import { requireEtlAccess } from "@/lib/etl/auth";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireEtlAccess(request);
  if (!auth.ok) return auth.response;

  const { clientId } = await params;
  if (!clientId) return json(400, { ok: false, error: "Missing clientId" });

  const supabase = createAdminClient();
  const { data: clientRow } = await supabase
    .from("clients")
    .select("slug, status")
    .eq("id", clientId)
    .maybeSingle();
  if (!clientRow) return json(404, { ok: false, error: "Client not found" });

  const outcome = await withEtlRun(
    {
      clientId,
      source: "ghl_full",
      clientSlug: clientRow.slug,
    },
    () => runGhlPull({ clientId }),
  );

  if (outcome.ok) {
    return json(200, {
      ok: true,
      runId: outcome.runId,
      rowsWritten: outcome.rowsWritten,
      durationMs: outcome.durationMs,
      triggeredBy: auth.by,
    });
  }
  return json(500, {
    ok: false,
    runId: outcome.runId,
    error: outcome.error,
    durationMs: outcome.durationMs,
    triggeredBy: auth.by,
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
