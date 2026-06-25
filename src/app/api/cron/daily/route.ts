/**
 * GET /api/cron/daily
 *
 * Vercel-cron entrypoint. Fires once a day per `vercel.json`. Iterates
 * every active OR paused client and triggers a Meta + GHL pull for each.
 * Pausing a client only hides the dashboard from the client's own users
 * (resolveAccess gates client_user login to active clients) — it must NOT
 * stop data collection, so an un-pause leaves no gap in history. Only
 * soft-deleted clients are skipped.
 *
 * Concurrency model:
 *   - Across clients: PARALLEL via Promise.allSettled. One client's GHL
 *     pull doesn't block another's. The slowest client now also includes a
 *     social pull (~20s for a connected account's 7-day window), so the
 *     budget is set generously below.
 *   - Within a client: SEQUENTIAL — Meta then GHL. Avoids two outbound
 *     requests against the same client account at once and keeps the
 *     Slack feed for one client coherent in time.
 *   - `Promise.allSettled`: a failure for one client never aborts the
 *     others. Each pull is wrapped in withEtlRun, so failures end up in
 *     etl_runs + Slack independently.
 *
 * Authorization: requires `Authorization: Bearer ${CRON_SECRET}`. Vercel
 * injects this header automatically on scheduled invocations. If you ever
 * need to fire this manually (debugging), use:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/cron/daily
 *
 * Returns a per-client breakdown so you can see what happened in Vercel
 * logs without digging into the etl_runs table.
 */
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { SOCIAL_CACHE_TAG } from "@/lib/socials-timeseries";
import { runMetaPull } from "@/lib/etl/meta";
import { runGhlPull } from "@/lib/etl/ghl";
import { runSocialDailyPull } from "@/lib/etl/social";
import { runSocialPostsPull } from "@/lib/etl/social-posts";
import { runSeoDailyPull } from "@/lib/etl/seo";
import { runLocalGridPull } from "@/lib/etl/seo-local-grid";
import { withEtlRun } from "@/lib/etl/runs";
import { requireEtlAccess } from "@/lib/etl/auth";
import { parseEnabledServices } from "@/lib/auth";
import {
  notifyEtlDigest,
  type DigestClient,
  type DigestPlatform,
  type DigestCheckStatus,
} from "@/lib/etl/slack";

/** Human labels for the social sub-sources surfaced in the daily digest. The
 *  keys match the `EtlBreakdownItem.key` set by runSocialDailyPull (one per
 *  SocialPlatform). */
const SOCIAL_LABEL: Record<string, string> = {
  meta_facebook: "Facebook",
  meta_instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

// Node runtime (default — no edge export). Hobby/free allows up to 300s, so we
// take headroom: the per-client social pull added ~20s on top of Meta + GHL,
// and this fans out across all active clients.
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = await requireEtlAccess(request);
  if (!auth.ok) return auth.response;

  const supabase = createAdminClient();
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, slug, enabled_services")
    // Active AND paused: a paused client keeps collecting data (the pause only
    // hides the dashboard from its own users) so there's no gap when it's
    // un-paused. "deleted" is the only status excluded from the nightly pull.
    .in("status", ["active", "paused"])
    .order("slug", { ascending: true });

  if (error) return json(500, { ok: false, error: error.message });
  if (!clients?.length) return json(200, { ok: true, message: "No active or paused clients", clients: [] });

  // Per-client work — gated by the client's enabled_services so we NEVER run a
  // pull for a product the client doesn't have. This is what keeps the nightly
  // run (and its Slack feed) honest: runMetaPull/runGhlPull THROW when a client
  // has no Meta/Asera credentials, and withEtlRun fires a Slack failure ping on
  // every throw — so a socials-only (or web-only) client used to get spurious
  // "Meta ads failed / Leads failed" alerts every single night. Gating means a
  // client only ever pulls — and is only ever reported on — for services it
  // actually owns. A skipped pull is recorded as `null` below.
  //   ads     → Meta ads + Leads (GHL)
  //   socials → social daily + social posts
  //   web     → SEO daily (GSC/GA4/Bing) + Local grid (BrightLocal; self-skips
  //             when the client has no linked reports, i.e. no `seo` upsell)
  const settled = await Promise.allSettled(
    clients.map(async (c) => {
      const svc = new Set(parseEnabledServices(c.enabled_services));
      const hasAds = svc.has("ads");
      const hasSocials = svc.has("socials");
      const hasWeb = svc.has("web");

      const meta = hasAds
        ? await withEtlRun(
            { clientId: c.id, source: "meta_daily", clientSlug: c.slug },
            () => runMetaPull({ clientId: c.id }),
          )
        : null;
      const ghl = hasAds
        ? await withEtlRun(
            { clientId: c.id, source: "ghl_full", clientSlug: c.slug },
            () => runGhlPull({ clientId: c.id }),
          )
        : null;
      // Social daily snapshot — re-pulls a 7-day sliding window for every
      // connected platform and upserts into social_daily_metrics.
      const social = hasSocials
        ? await withEtlRun(
            { clientId: c.id, source: "social_daily", clientSlug: c.slug },
            () => runSocialDailyPull({ clientId: c.id }),
          )
        : null;
      // Per-post pull for the "Top performing content" cards. MUST run after
      // the daily snapshot: tiktokPostRows reads the client_tiktok_videos
      // JSONB that runSocialDailyPull just refreshed (avoids a second TikTok
      // token refresh, which rotates the refresh token).
      const socialPosts = hasSocials
        ? await withEtlRun(
            { clientId: c.id, source: "social_posts", clientSlug: c.slug },
            () => runSocialPostsPull({ clientId: c.id }),
          )
        : null;
      // SEO daily — GSC + GA4 (Kris/DWD) + Bing → seo_* tables.
      const seo = hasWeb
        ? await withEtlRun(
            { clientId: c.id, source: "seo_daily", clientSlug: c.slug },
            () => runSeoDailyPull({ clientId: c.id }),
          )
        : null;
      // Local Search Grid (BrightLocal geo-grid) — READ-only, daily (reads are
      // free). Self-skips (empty breakdown, no noise) for web clients with no
      // linked reports in client_lsg_reports; does real work only once the
      // `seo` upsell is wired up with reports.
      const seoGrid = hasWeb
        ? await withEtlRun(
            { clientId: c.id, source: "seo_local_grid", clientSlug: c.slug },
            () => runLocalGridPull({ clientId: c.id }),
          )
        : null;
      return { slug: c.slug, meta, ghl, social, socialPosts, seo, seoGrid };
    }),
  );

  // Socials data just refreshed for (potentially) every client — bust the
  // socials read cache so the dashboards reflect this pull immediately instead
  // of serving up to REVALIDATE_SECONDS of stale numbers. One global tag busts
  // all clients at once, which is exactly the scope the nightly cron touched.
  // { expire: 0 } = HARD purge (not stale-while-revalidate) so the next render
  // recomputes fresh rather than serving one last pre-pull blob.
  revalidateTag(SOCIAL_CACHE_TAG, { expire: 0 });

  // Build a flat per-client summary for the response. Crashes inside the
  // outer await (e.g. a thrown DB error before withEtlRun can log) show up
  // as `status: "rejected"`; everything else is in the meta/ghl outcomes.
  const summary = settled.map((res, i) => {
    const slug = clients[i].slug;
    if (res.status === "rejected") {
      return { slug, ok: false, error: String(res.reason) };
    }
    const { meta, ghl, social, socialPosts, seo, seoGrid } = res.value;
    // `null` = pull skipped (client doesn't own that product).
    return {
      slug,
      meta: meta ? outcomeShape(meta) : null,
      ghl: ghl ? outcomeShape(ghl) : null,
      social: social ? outcomeShape(social) : null,
      socialPosts: socialPosts ? outcomeShape(socialPosts) : null,
      seo: seo ? outcomeShape(seo) : null,
      seoGrid: seoGrid ? outcomeShape(seoGrid) : null,
    };
  });

  // Daily Slack digest: one message summarising every client × platform so a
  // SILENTLY-failing platform (its fetcher swallowed a bad response and the run
  // still "succeeded" with 0 rows) is still surfaced. Best-effort — notifyEtlDigest
  // swallows its own POST errors so a Slack hiccup never affects the cron outcome.
  //   - Meta ads / Leads: 0 rows is NORMAL (paused campaign, no lead that day),
  //     so they only show 🚨 on a thrown error, never ⚠️.
  //   - Social platforms: a connected account should always write ~7 sliding-window
  //     rows, so 0 rows IS suspicious → ⚠️ "empty".
  //   - social_posts is intentionally excluded (it's not one of the 6 tracked
  //     surfaces); a posts failure is still covered by its own notifyEtlFailure ping.
  //   - A `null` outcome means the pull was SKIPPED (client doesn't own that
  //     product), so its row is omitted entirely — the digest only ever lists
  //     services a client actually has, and never flags one it doesn't.
  const digestClients: DigestClient[] = settled.map((res, i) => {
    const slug = clients[i].slug;
    if (res.status === "rejected") {
      return { slug, platforms: [{ label: "Pull", status: "error", error: String(res.reason) }] };
    }
    const { meta, ghl, social, seo, seoGrid } = res.value;
    const platforms: DigestPlatform[] = [];
    // Ads product → Meta + Leads. 0 rows is NORMAL here (paused campaign / no
    // lead that day), so these only ever go 🚨 on a thrown error, never ⚠️.
    if (meta) {
      platforms.push({ label: "Meta ads", status: meta.ok ? "ok" : "error", error: meta.ok ? undefined : meta.error });
    }
    if (ghl) {
      platforms.push({ label: "Leads", status: ghl.ok ? "ok" : "error", error: ghl.ok ? undefined : ghl.error });
    }
    if (social) {
      if (!social.ok) {
        // The whole social run threw before any per-platform breakdown existed.
        platforms.push({ label: "Socials", status: "error", error: social.error });
      } else {
        for (const b of social.breakdown ?? []) {
          const status: DigestCheckStatus = !b.ok ? "error" : b.rows > 0 ? "ok" : "empty";
          platforms.push({ label: SOCIAL_LABEL[b.key] ?? b.key, status, error: b.error });
        }
      }
    }
    // SEO sub-sources (google / ga4 / bing). Empty breakdown = web client not
    // yet wired for SEO sources, so nothing is added (no noise).
    if (seo) {
      if (!seo.ok) {
        platforms.push({ label: "SEO", status: "error", error: seo.error });
      } else {
        for (const b of seo.breakdown ?? []) {
          // Bing data isn't surfaced anywhere in the dashboard, so a Bing pull
          // failure is irrelevant — never include it in the digest (it would
          // otherwise trip the failures-only Slack alert for no reason).
          if (b.key === "bing") continue;
          const status: DigestCheckStatus = !b.ok ? "error" : b.rows > 0 ? "ok" : "empty";
          platforms.push({ label: "SEO·" + b.key, status, error: b.error });
        }
      }
    }
    // Local Search Grid — only surfaced when a grid is configured (empty
    // breakdown = no report id = nothing to report, no noise). A whole-run
    // throw still shows up.
    if (seoGrid) {
      if (!seoGrid.ok) {
        platforms.push({ label: "Local grid", status: "error", error: seoGrid.error });
      } else if ((seoGrid.breakdown ?? []).length) {
        // A per-report failure is caught inside the pull (run still "succeeds"),
        // so forward the failed breakdown item's error — otherwise the digest
        // showed a useless "unknown error".
        const failed = seoGrid.breakdown!.filter((b) => !b.ok);
        const totalRows = seoGrid.breakdown!.reduce((a, b) => a + b.rows, 0);
        platforms.push(
          failed.length
            ? { label: "Local grid", status: "error", error: failed.map((b) => b.error).filter(Boolean).join("; ") || undefined }
            : { label: "Local grid", status: totalRows > 0 ? "ok" : "empty" },
        );
      }
    }
    return { slug, platforms };
  });
  await notifyEtlDigest(digestClients);

  const allOk = summary.every(
    (s) =>
      (!("error" in s) || !s.error) &&
      s.meta?.ok !== false &&
      s.ghl?.ok !== false &&
      s.social?.ok !== false &&
      s.socialPosts?.ok !== false &&
      s.seo?.ok !== false &&
      s.seoGrid?.ok !== false,
  );

  return json(allOk ? 200 : 207, {
    ok: allOk,
    triggeredBy: auth.by,
    clientCount: clients.length,
    clients: summary,
  });
}

/** Trim outcome to the safe-to-return summary shape. */
function outcomeShape(
  o:
    | { ok: true; runId: string; rowsWritten: number; durationMs: number }
    | { ok: false; runId: string; error: string; durationMs: number },
) {
  if (o.ok) {
    return { ok: true, runId: o.runId, rowsWritten: o.rowsWritten, durationMs: o.durationMs };
  }
  return { ok: false, runId: o.runId, error: o.error, durationMs: o.durationMs };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
