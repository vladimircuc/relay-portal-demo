/**
 * withEtlRun — single wrapper around every ETL pull (meta_daily,
 * meta_backfill, ghl_full). Handles three orthogonal concerns:
 *
 *   1. `etl_runs` logging. Every invocation produces one row capturing
 *      the source, status, row count, timestamps, and (on failure) the
 *      error message. The admin "ETL Status" UI reads from this table.
 *
 *   2. Cache invalidation. On success, busts the right unstable_cache
 *      tag so the dashboard sees fresh data on the next request — no
 *      need to wait for the 5-minute revalidate window.
 *
 *   3. Slack notification on failure (Step 8). For now it no-ops if
 *      SLACK_WEBHOOK_URL isn't set.
 *
 * Always use this wrapper from API routes / cron handlers. NEVER call
 * runMetaPull / runGhlPull directly from a route — you'll lose logging
 * and the admin UI will look like nothing ran.
 *
 * Returns the saved `etl_runs` row id + outcome, so callers can build a
 * deep link or response.
 */
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyEtlFailure } from "./slack";

/** Mirrors the CHECK constraint on etl_runs.source (see migration 023 for
 *  the social_* additions). */
export type EtlSource =
  | "meta_daily"
  | "meta_backfill"
  | "ghl_full"
  | "social_daily"
  | "social_backfill"
  | "social_posts"
  | "seo_daily"
  | "seo_local_grid";

/** One sub-source within a single ETL run, for the daily Slack digest. A
 *  `social_daily` run fans out across FB / IG / YouTube / TikTok internally;
 *  this surfaces each platform's outcome so a silently-failing one (its fetcher
 *  swallows the error and the run still "succeeds") is still visible. `key` is a
 *  free-form label (e.g. the SocialPlatform); `rows` = rows written for it;
 *  `ok=false` means that sub-fetch THREW (vs ok+rows=0 = wrote nothing). */
export type EtlBreakdownItem = { key: string; ok: boolean; rows: number; error?: string };

export type EtlPullResult = {
  rowsWritten: number;
  /** Optional per-sub-source breakdown (e.g. social platforms in one run). */
  breakdown?: EtlBreakdownItem[];
};

export type EtlRunOutcome =
  | { ok: true;  runId: string; rowsWritten: number; durationMs: number; breakdown?: EtlBreakdownItem[] }
  | { ok: false; runId: string; error: string;       durationMs: number };

export async function withEtlRun(
  args: {
    clientId: string;
    source: EtlSource;
    /** Optional: forwarded to Slack notifier for nicer messages. */
    clientSlug?: string;
  },
  fn: () => Promise<EtlPullResult>,
): Promise<EtlRunOutcome> {
  const { clientId, source, clientSlug } = args;
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  const supabase = createAdminClient();

  let result: EtlPullResult;
  try {
    result = await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();

    // Best-effort log; if even the insert fails we still want to bubble
    // the original error up to the caller.
    const { data } = await supabase
      .from("etl_runs")
      .insert({
        client_id: clientId,
        source,
        status: "failure",
        rows_written: 0,
        started_at: startedAtIso,
        finished_at: finishedAt.toISOString(),
        error_message: message,
      })
      .select("id")
      .single();

    // Fire-and-forget Slack ping. Wait for it so we don't drop the alert,
    // but the notifier itself swallows its own errors so this never
    // throws.
    await notifyEtlFailure({
      clientId,
      clientSlug,
      source,
      message,
    });

    return {
      ok: false,
      runId: (data?.id as string | undefined) ?? "",
      error: message,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }

  const finishedAt = new Date();

  const { data, error: logErr } = await supabase
    .from("etl_runs")
    .insert({
      client_id: clientId,
      source,
      status: "success",
      rows_written: result.rowsWritten,
      started_at: startedAtIso,
      finished_at: finishedAt.toISOString(),
    })
    .select("id")
    .single();

  // Don't fail the whole pull just because logging didn't work — the
  // data is already written. Log it server-side so we still see it.
  if (logErr) {
    console.error("[withEtlRun] etl_runs log insert failed:", logErr.message);
  }

  // Cache bust so the dashboard reflects fresh data on next request.
  invalidateForSource(source);

  return {
    ok: true,
    runId: (data?.id as string | undefined) ?? "",
    rowsWritten: result.rowsWritten,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    breakdown: result.breakdown,
  };
}

function invalidateForSource(source: EtlSource): void {
  // Next 16's revalidateTag signature is `(tag, profile)`. "default" tells
  // it to invalidate immediately (the standard profile from next/cache).
  // Meta pulls feed meta_daily → daily_metrics_v → dashboard metric cards.
  if (source === "meta_daily" || source === "meta_backfill") {
    revalidateTag("daily-metrics", "default");
  }
  // GHL pulls feed ghl_opportunities → funnel + source breakdown.
  if (source === "ghl_full") {
    revalidateTag("ghl-opps", "default");
    // daily_metrics_v also derives some columns (leads, bookings, shows,
    // conversions) from ghl_opportunities, so the daily metrics cache
    // needs busting too.
    revalidateTag("daily-metrics", "default");
  }
  // Social pulls feed social_daily_metrics → /socials chart + tiles;
  // social_posts feeds the same page's "Top performing content" cards.
  if (source === "social_daily" || source === "social_backfill" || source === "social_posts") {
    revalidateTag("socials-series", "default");
  }
  // SEO pulls feed seo_daily_metrics / seo_ga4_* / seo_top_* → /seo dashboard.
  // The geo-grid read feeds seo_local_grid → the Local SEO map on the same tab.
  if (source === "seo_daily" || source === "seo_local_grid") {
    revalidateTag("seo-series", "default");
  }
}
