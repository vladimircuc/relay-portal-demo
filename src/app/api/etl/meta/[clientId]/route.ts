/**
 * POST /api/etl/meta/[clientId]
 *
 * Triggers a Meta Ads ETL pull for one client. Two shapes:
 *
 *   POST … {}                                    → yesterday only (source=meta_daily)
 *   POST … { "since": "yyyy-MM-dd", "until": "yyyy-MM-dd" }
 *                                                → custom range  (source=meta_backfill)
 *
 * Authorization:
 *   - The Vercel daily cron (Bearer CRON_SECRET), OR
 *   - A super-admin browser session.
 *
 * Response:
 *   200 { ok: true,  runId, rowsWritten, durationMs }
 *   500 { ok: false, runId, error,      durationMs }   — pull threw
 *   401 / 403 / 404 for auth/lookup issues
 *
 * Wraps the actual pull in withEtlRun, so an `etl_runs` row is written
 * either way, the dashboard cache is invalidated on success, and Slack
 * is pinged on failure (once SLACK_WEBHOOK_URL is set in Step 8).
 */
import { createAdminClient } from "@/lib/supabase/server";
import { runMetaPull } from "@/lib/etl/meta";
import { withEtlRun } from "@/lib/etl/runs";
import { requireEtlAccess } from "@/lib/etl/auth";

// Default Node runtime — GHL/Meta pulls can take longer than Edge's 25s
// on Hobby plan. Meta is usually fast (≤5s for a daily pull, ≤30s for a
// 90-day backfill) but better safe than sorry.
export const maxDuration = 60; // seconds; bumped automatically on Pro plan.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const auth = await requireEtlAccess(request);
  if (!auth.ok) return auth.response;

  const { clientId } = await params;
  if (!clientId) return json(400, { ok: false, error: "Missing clientId" });

  // Parse optional date range.
  let since: string | undefined;
  let until: string | undefined;
  try {
    const body = (await request.json()) as { since?: string; until?: string };
    since = typeof body.since === "string" && body.since ? body.since : undefined;
    until = typeof body.until === "string" && body.until ? body.until : undefined;
  } catch {
    // No JSON body / empty body — fine, do a daily pull.
  }

  const isBackfill = since !== undefined || until !== undefined;

  // Look up the client slug for nicer Slack messages. Best-effort.
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
      source: isBackfill ? "meta_backfill" : "meta_daily",
      clientSlug: clientRow.slug,
    },
    () => runMetaPull({ clientId, since, until }),
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
