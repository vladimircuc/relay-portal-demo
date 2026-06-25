/**
 * GET /api/social/backfill/status?clientId=<uuid>
 *
 * Lightweight poll target for the on-connect "pulling your history…" overlay
 * (<SocialBackfillOverlay/>). After a connect kicks the heavy backfill in the
 * background, the overlay polls this every few seconds to drive a per-platform
 * progress UI and to know when to dismiss + refresh the page.
 *
 * Returns the MOST-RECENT social_backfill_jobs row per platform within a short
 * recency window (a platform can have several rows across re-triggers; only the
 * newest matters), plus a derived `active` flag (any job still pending/running).
 *
 * Auth: session-scoped to someone who can manage this client's socials — the
 * same gate as the manual "Backfill" button. This is a browser poll, NOT the
 * internal CRON_SECRET path.
 *
 * Cheap by design (one indexed select), so it's safe to hit on a short interval.
 */
import { NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

// Only jobs touched within this window count toward an "in-progress" connect.
// Comfortably covers the slowest backfill (Instagram ~3.5 min) plus the kick's
// cold-start lag, while ignoring stale jobs from earlier in the day.
const RECENT_MS = 15 * 60 * 1000;

type JobRow = {
  platform: string;
  status: "pending" | "running" | "done" | "error";
  rows_written: number | null;
  error: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get("clientId") ?? "";
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Missing clientId" }, { status: 400 });
  }

  // Gate to anyone who can access this client (viewers included — they can now
  // self-serve connect, so they poll this too). requireClientAccess throws
  // ("Not authenticated" / "Forbidden") — translate to a clean 403 so the
  // poller can stop quietly instead of spamming an error overlay.
  try {
    await requireClientAccess(clientId);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Forbidden" },
      { status: 403 },
    );
  }

  const supabase = createAdminClient();
  const sinceIso = new Date(Date.now() - RECENT_MS).toISOString();
  const { data, error } = await supabase
    .from("social_backfill_jobs")
    .select("platform, status, rows_written, error, created_at")
    .eq("client_id", clientId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });

  if (error) {
    const errorId = crypto.randomUUID();
    console.error(`[social/backfill/status] query failed (errorId=${errorId})`, error);
    return NextResponse.json({ ok: false, error: "Lookup failed", errorId }, { status: 500 });
  }

  // Keep only the newest job per platform (rows already sorted newest-first).
  const latestByPlatform = new Map<string, JobRow>();
  for (const row of (data ?? []) as JobRow[]) {
    if (!latestByPlatform.has(row.platform)) latestByPlatform.set(row.platform, row);
  }
  const jobs = [...latestByPlatform.values()].map((j) => ({
    platform: j.platform,
    status: j.status,
    rowsWritten: j.rows_written ?? 0,
    error: j.error ?? null,
  }));
  const active = jobs.some((j) => j.status === "pending" || j.status === "running");

  return NextResponse.json({ ok: true, active, jobs });
}
