/**
 * POST /api/social/backfill?clientId=<uuid>[&platform=<series>][&limit=<n>]
 *
 * Admin-triggered historical backfill of social_daily_metrics. Pulls the
 * deepest history each connected platform allows (YouTube full, FB ~2y,
 * IG ~2y for views/engagement/etc. — follower history is 30-day-capped by
 * Meta and back-projected at read time, TikTok snapshot-only) and upserts
 * with source='backfill'.
 * Per-platform progress is tracked in social_backfill_jobs.
 *
 * Wrapped in withEtlRun so the run shows up in the admin ETL status feed and
 * Slack on failure. Intended to be called right after a connect (or manually
 * from the admin UI).
 *
 * Runtime: NODE, not edge. A deep backfill runs for minutes — Instagram alone
 * is ~3.5 min of throttled 1-call-per-day insights — and the Edge runtime must
 * emit its first byte within 25s. The Node runtime allows up to 300s on EVERY
 * plan including Hobby/free (Vercel Functions limits, 2026), which covers the
 * slowest case with margin. No paid plan required. Trigger per-platform
 * (?platform=) to keep each invocation well under the ceiling and resumable —
 * upserts are idempotent, so a re-trigger safely re-covers an interrupted run.
 */
import { NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { requireClientAccess } from "@/lib/auth";
import { timingSafeEqualStr } from "@/lib/etl/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { withEtlRun } from "@/lib/etl/runs";
import { runSocialBackfill, type SocialPlatform } from "@/lib/etl/social";
import { resetSocialData } from "@/lib/etl/social-reset";
import { runSocialPostsPull } from "@/lib/etl/social-posts";
import { SOCIAL_CACHE_TAG } from "@/lib/socials-timeseries";

export const runtime = "nodejs";
export const maxDuration = 300;

const VALID_PLATFORMS: SocialPlatform[] = [
  "meta_facebook", "meta_instagram", "youtube", "tiktok", "linkedin",
];

export async function POST(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "Missing clientId" }, { status: 400 });
  }

  // Dual auth: the on-connect kick (and the nightly cron) come in with the
  // internal Bearer CRON_SECRET — no user session — while a manual "Backfill"
  // / connect from the browser comes in with a session cookie. The user path
  // is open to anyone who can access this client (viewers included), matching
  // the self-serve connect flow that kicks this route.
  const cronSecret = process.env.CRON_SECRET;
  const authz = request.headers.get("authorization");
  const isInternal = !!cronSecret && authz != null && timingSafeEqualStr(authz, `Bearer ${cronSecret}`);
  if (!isInternal) {
    await requireClientAccess(clientId);
  }

  const platformParam = url.searchParams.get("platform");
  if (platformParam && !VALID_PLATFORMS.includes(platformParam as SocialPlatform)) {
    return NextResponse.json({ ok: false, error: `Unknown platform: ${platformParam}` }, { status: 400 });
  }

  const platform = (platformParam as SocialPlatform | null) ?? undefined;

  // reset=1 → wipe the target platform(s)' stored data before refilling. An
  // EXPLICIT, opt-in admin purge for a clean "re-backfill from scratch". NOTE:
  // it deletes across ALL accounts for the platform (not account-scoped), so it
  // also drops dormant accounts' preserved history — hence it's reserved for the
  // deliberate manual admin action. The on-connect kick never sets it: under
  // account-scoped retention (migration 028) a reconnect starts a fresh series
  // keyed by the new account_id without touching the old data.
  const reset = url.searchParams.get("reset") === "1";
  // background=1 → return 202 immediately and run the (minutes-long) backfill in
  // after(), within this Node invocation's 300s budget. Used by the on-connect
  // kick so the caller's fetch resolves fast; the manual button runs synchronously.
  const background = url.searchParams.get("background") === "1";

  // How many recent posts to seed into "Top performing content". Default 50;
  // a deeper backfill can request more (clamped to 500 to stay inside the 300s
  // Node ceiling — IG is the slow path at ~1 throttled insights call/post).
  const limitParam = Number(url.searchParams.get("limit"));
  const postsLimit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 500) : 50;

  const runBackfill = async () => {
    if (reset) {
      const supabase = createAdminClient();
      await resetSocialData(supabase, clientId, platform ? [platform] : VALID_PLATFORMS);
    }

    const outcome = await withEtlRun(
      { clientId, source: "social_backfill" },
      () => runSocialBackfill({ clientId, platform }),
    );

    // Seed the "Top performing content" cards for the platform(s) we just
    // backfilled. Runs AFTER runSocialBackfill so TikTok's client_tiktok_videos
    // snapshot (refreshed by the backfill) is current — tiktokPostRows reads it
    // and makes no API call, so the TikTok token isn't refreshed twice. Scoped
    // to `platform` so a single-platform backfill doesn't re-pull the others. A
    // larger limit than the nightly cron seeds more history in one shot.
    const posts = await withEtlRun(
      { clientId, source: "social_posts" },
      () => runSocialPostsPull({
        clientId,
        limit: postsLimit,
        source: "backfill",
        platforms: platform ? [platform] : undefined,
      }),
    );

    // Fresh history landed → bust the socials read cache so the dashboard shows
    // it immediately. The on-connect overlay reloads /socials the moment this
    // run finishes; without this it would re-read up to REVALIDATE_SECONDS of
    // stale (or empty) cached numbers. Safe in both the synchronous and the
    // after() background paths below. { expire: 0 } = a HARD purge (not
    // stale-while-revalidate), so the overlay's reload recomputes fresh rather
    // than serving the pre-backfill (empty) blob once.
    revalidateTag(SOCIAL_CACHE_TAG, { expire: 0 });

    return { outcome, posts };
  };

  // Fire-and-respond: hand the work to after() and return 202 so the on-connect
  // kick's fetch doesn't block. The run is still logged to etl_runs by withEtlRun.
  if (background) {
    after(async () => {
      try {
        await runBackfill();
      } catch (e) {
        console.error("[social/backfill] background run failed:", e);
      }
    });
    return NextResponse.json(
      { ok: true, status: "scheduled", background: true, platform: platform ?? "all" },
      { status: 202 },
    );
  }

  const { outcome, posts } = await runBackfill();
  return NextResponse.json({ ok: outcome.ok && posts.ok, outcome, posts });
}
