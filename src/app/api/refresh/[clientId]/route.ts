/**
 * POST /api/refresh/[clientId]
 *
 * Public "Refresh data" endpoint that drives the small refresh button in
 * the dashboard header. Triggers an on-demand Meta + Asera pull and busts
 * the dashboard's cache so fresh data shows up on the next render.
 *
 * Why this is a route handler instead of a server action:
 *   We had this as a server action (refreshClientNow) called from the
 *   /<slug>/ads page. Server actions inherit maxDuration from the
 *   calling page, but on Vercel that inheritance is inconsistent —
 *   sometimes the action got the page's 60s budget, sometimes it
 *   defaulted to 25s, and a 40s GHL pull would get killed mid-flight
 *   with a generic "An unexpected response was received from the
 *   server" toast. Moving the logic into its own POST endpoint means
 *   maxDuration is declared explicitly on the route, the function is
 *   deployed as a discrete unit, and the runtime contract is
 *   predictable.
 *
 * Auth: requireClientAccess — super_admin / admin / matching client_user
 * for this client. Read-only viewers can refresh their own dashboard,
 * nobody can refresh someone else's.
 *
 * Cooldown: same 60s post-completion + 5min in-flight window we had on
 * the action. Server-enforced via the latest etl_runs row.
 *
 * Concurrency: Meta and GHL pulls run in parallel (Promise.all). They're
 * independent (different upstream APIs, different DB tables), so there's
 * no reason to serialize. Total budget caps at max(meta, ghl) ≈ 40s for
 * a 1700-opp client.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireClientAccess } from "@/lib/auth";
import { runMetaPull } from "@/lib/etl/meta";
import { runGhlPull } from "@/lib/etl/ghl";
import { withEtlRun } from "@/lib/etl/runs";

// Node runtime gives us reliable 60s budget on Pro without the edge
// runtime's server-action-inheritance quirks. The work is plain HTTP +
// supabase-js, no edge-specific APIs needed.
export const runtime = "nodejs";
export const maxDuration = 60;

const COOLDOWN_SECONDS = 60;
const IN_FLIGHT_WINDOW_SECONDS = 300;

export type RefreshResponse =
  | { ok: true; metaOk: boolean; ghlOk: boolean; messages: string[] }
  | { ok: false; reason: "cooldown"; retryAfterSeconds: number }
  | { ok: false; reason: "error"; message: string };

function json(status: number, body: RefreshResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  const { clientId } = await ctx.params;
  if (!clientId) {
    return json(400, { ok: false, reason: "error", message: "Missing clientId" });
  }

  // The button passes clientSlug in the body so we can revalidate the
  // right path. (We could look it up via clientId → slug but that's
  // another DB roundtrip on a hot path.)
  const body = (await request.json().catch(() => ({}))) as { clientSlug?: string };
  const clientSlug = body.clientSlug;
  if (!clientSlug) {
    return json(400, { ok: false, reason: "error", message: "Missing clientSlug" });
  }

  try {
    await requireClientAccess(clientId);
  } catch (e) {
    return json(403, {
      ok: false,
      reason: "error",
      message: e instanceof Error ? e.message : "Forbidden",
    });
  }

  const supabase = createAdminClient();

  // ── Cooldown / in-flight check ──────────────────────────────────────────
  const { data: recent } = await supabase
    .from("etl_runs")
    .select("started_at, finished_at")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    const startedAt = new Date(recent.started_at).getTime();
    const finishedAt = recent.finished_at
      ? new Date(recent.finished_at).getTime()
      : null;
    const now = Date.now();

    if (finishedAt === null && now - startedAt < IN_FLIGHT_WINDOW_SECONDS * 1000) {
      const elapsedSec = Math.floor((now - startedAt) / 1000);
      const retryAfter = Math.max(15, IN_FLIGHT_WINDOW_SECONDS - elapsedSec);
      return json(200, { ok: false, reason: "cooldown", retryAfterSeconds: retryAfter });
    }

    if (finishedAt !== null) {
      const sinceFinish = (now - finishedAt) / 1000;
      if (sinceFinish < COOLDOWN_SECONDS) {
        return json(200, {
          ok: false,
          reason: "cooldown",
          retryAfterSeconds: Math.ceil(COOLDOWN_SECONDS - sinceFinish),
        });
      }
    }
  }

  // ── Run both pulls in PARALLEL ──────────────────────────────────────────
  const messages: string[] = [];

  const [metaOutcome, ghlOutcome] = await Promise.all([
    withEtlRun(
      { clientId, source: "meta_daily", clientSlug },
      () => runMetaPull({ clientId }),
    ),
    withEtlRun(
      { clientId, source: "ghl_full", clientSlug },
      () => runGhlPull({ clientId }),
    ),
  ]);
  if (!metaOutcome.ok) messages.push(`Meta: ${metaOutcome.error}`);
  if (!ghlOutcome.ok) messages.push(`Asera: ${ghlOutcome.error}`);

  revalidatePath(`/${clientSlug}/ads`);
  revalidatePath(`/${clientSlug}/admin`);

  return json(200, {
    ok: true,
    metaOk: metaOutcome.ok,
    ghlOk: ghlOutcome.ok,
    messages,
  });
}
