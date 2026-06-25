/**
 * Read layer over `social_daily_metrics` (migration 023). The write side
 * (cron + backfill) lives in lib/etl/social.ts; this is what the /socials
 * UI reads from once the date selector (Task 3) and chart (Task 4) land.
 *
 * Two functions for now:
 *   - fetchSocialDateBounds → earliest/latest stored day, to bound the date
 *     picker (mirrors how /ads derives minSelectable / dataEnd).
 *   - fetchSocialDailyRows  → the per-day per-platform rows for a range, the
 *     raw material the chart + tiles aggregate.
 *
 * Aggregation into chart series / tile totals is intentionally left to the
 * chart component (Task 4) so the shape can be tuned to recharts without
 * round-tripping through here.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import {
  activeAccountIds,
  activeAccountOrFilter,
  UNKNOWN_ACCOUNT,
} from "@/lib/etl/social-accounts";
import type { SocialPlatform } from "@/lib/etl/social";
import type { ContentMediaType, TopContentItem } from "@/components/top-content";
import type { ContentItem } from "@/components/content-library";
import type { ContentTypeSlice } from "@/components/content-type-breakdown";

/** Cross-request cache window for the socials read layer (mirrors the ads
 *  dashboard's dashboard-data.ts). Each page-level loader hits Supabase at most
 *  once per this window per (function, args); a warm /socials navigation then
 *  serves entirely from cache. Invalidated immediately on any data mutation via
 *  revalidateTag(SOCIAL_CACHE_TAG), so connects / account switches /
 *  disconnects / backfills / the nightly cron reflect right away rather than
 *  waiting the window out. */
const REVALIDATE_SECONDS = 300;

/** revalidateTag key tagging every cached socials read. Mutation sites (the
 *  backfill route, the daily cron, the Meta page pick, disconnect) call
 *  revalidateTag(SOCIAL_CACHE_TAG) to bust the whole socials cache at once.
 *  Necessary because the cache key is (clientId, range) while the ACTIVE
 *  account scope is resolved INSIDE each loader — so an account switch or
 *  disconnect wouldn't otherwise change the key, and stale data for the wrong
 *  account could be served until the TTL lapsed. */
export const SOCIAL_CACHE_TAG = "social-metrics";

/**
 * Resolve the client's ACTIVE (platform → account_id) pairs and the PostgREST
 * `.or()` filter that scopes social_daily_metrics / social_posts reads to them
 * (migration 028). A different account's rows are retained but DORMANT — never
 * surfaced in the UI. `accountOr === null` means nothing is connected, so every
 * caller short-circuits to an empty result rather than run an unscoped query
 * that would leak a switched-away account's history.
 */
async function resolveAccountScope(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string,
): Promise<{ active: Map<SocialPlatform, string>; accountOr: string | null }> {
  const active = await activeAccountIds(supabase, clientId);
  return { active, accountOr: activeAccountOrFilter(active) };
}

export type SocialDailyRow = {
  platform: SocialPlatform;
  day: string; // yyyy-MM-dd
  followers: number | null;
  followers_delta: number | null;
  follows_gained: number | null;
  impressions: number | null;
  engagements: number | null;
  profile_visits: number | null;
  link_clicks: number | null;
  reach: number | null;               // daily unique reach (Instagram)
  watch_time_minutes: number | null;  // daily minutes watched (YouTube)
};

async function fetchSocialDateBoundsRaw(
  clientId: string,
): Promise<{ minDay: string | null; maxDay: string | null; lastRunAt: string | null }> {
  const supabase = createAdminClient();
  const { accountOr } = await resolveAccountScope(supabase, clientId);

  // The "last pulled" stamp for the header — the most recent SUCCESSFUL social
  // ETL run (daily snapshot, backfill, or posts pull). Mirrors the ads side's
  // lastRunAt, but scoped to the social sources so an ads-only pull doesn't
  // masquerade as a socials refresh. This is a RUN-level signal (etl_runs), not
  // account-scoped, so it's read regardless of which account is connected. Null
  // until the cron's social leg has run (a useful "socials never pulled" signal).
  const lastRun = supabase
    .from("etl_runs")
    .select("finished_at")
    .eq("client_id", clientId)
    .eq("status", "success")
    .in("source", ["social_daily", "social_backfill", "social_posts"])
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Date-picker bounds are scoped to the ACTIVE account(s) (migration 028) so a
  // dormant switched-away account's deeper history doesn't widen the picker.
  // Nothing connected → no bounds (but the run stamp may still exist).
  if (accountOr === null) {
    const lastRunRes = await lastRun;
    return {
      minDay: null,
      maxDay: null,
      lastRunAt: (lastRunRes.data as { finished_at: string } | null)?.finished_at ?? null,
    };
  }

  // Two cheap ordered-limit reads beat a maybeSingle aggregate through
  // PostgREST and are index-friendly on (client_id, day).
  const [minRes, maxRes, lastRunRes] = await Promise.all([
    supabase
      .from("social_daily_metrics")
      .select("day").eq("client_id", clientId).or(accountOr)
      .order("day", { ascending: true }).limit(1).maybeSingle(),
    supabase
      .from("social_daily_metrics")
      .select("day").eq("client_id", clientId).or(accountOr)
      .order("day", { ascending: false }).limit(1).maybeSingle(),
    lastRun,
  ]);
  return {
    minDay: (minRes.data as { day: string } | null)?.day ?? null,
    maxDay: (maxRes.data as { day: string } | null)?.day ?? null,
    lastRunAt: (lastRunRes.data as { finished_at: string } | null)?.finished_at ?? null,
  };
}

export async function fetchSocialDailyRows(args: {
  clientId: string;
  start: string; // yyyy-MM-dd inclusive
  end: string;   // yyyy-MM-dd inclusive
  /** Active-account scope from resolveAccountScope (migration 028). null when
   *  nothing is connected → no rows. */
  accountOr: string | null;
}): Promise<SocialDailyRow[]> {
  if (args.accountOr === null) return [];
  const supabase = createAdminClient();
  // Paginate — PostgREST caps a single response at ~1000 rows, and a 2-year
  // range × ~4 platforms blows past that. Order by (day, platform) so the page
  // boundaries are stable (no skips/dupes on day ties).
  const PAGE = 1000;
  const out: SocialDailyRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("social_daily_metrics")
      .select("platform, day, followers, followers_delta, follows_gained, impressions, engagements, profile_visits, link_clicks, reach, watch_time_minutes")
      .eq("client_id", args.clientId)
      .or(args.accountOr)
      .gte("day", args.start)
      .lte("day", args.end)
      .order("day", { ascending: true })
      .order("platform", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`social_daily_metrics read failed: ${error.message}`);
    const rows = (data ?? []) as SocialDailyRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export type MetricKey = "follows_gained" | "impressions" | "engagements" | "profile_visits" | "link_clicks" | "reach" | "watch_time";

/** One day's values for a metric: per-platform + total. Null where a platform
 *  has no data that day (or can't report the metric at all). Shaped for
 *  recharts (one object per day, a key per series). */
export type ChartPoint = { day: string } & Partial<Record<SocialPlatform | "total", number | null>>;

export type SocialsChartData = {
  /** Sorted platforms that have ANY data for the range (drives the legend). */
  platforms: SocialPlatform[];
  /** Per-metric daily series. */
  series: Record<MetricKey, ChartPoint[]>;
  /** Per metric, which platforms contributed any value (for the breakdown
   *  table — e.g. link_clicks is IG-only, profile_visits is FB+IG). */
  contributors: Record<MetricKey, SocialPlatform[]>;
};

/**
 * Build the chart's daily series from social_daily_metrics over [start, end].
 * Returns ALL five metrics so the client can switch the selected tile without
 * a re-fetch (the payload is tiny — days × 5 metrics × ≤5 platforms).
 */
export async function fetchSocialsChartSeries(args: {
  clientId: string;
  start: string;
  end: string;
}): Promise<SocialsChartData> {
  const supabase = createAdminClient();
  const { accountOr } = await resolveAccountScope(supabase, args.clientId);
  const rows = await fetchSocialDailyRows({ ...args, accountOr });

  const platforms = [...new Set(rows.map((r) => r.platform))].sort() as SocialPlatform[];
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const byKey = new Map<string, SocialDailyRow>();
  for (const r of rows) byKey.set(`${r.day}|${r.platform}`, r);

  const METRIC_FIELD: Record<MetricKey, keyof SocialDailyRow> = {
    follows_gained: "follows_gained",
    impressions: "impressions",
    engagements: "engagements",
    profile_visits: "profile_visits",
    link_clicks: "link_clicks",
    reach: "reach",
    watch_time: "watch_time_minutes",
  };

  const series = {} as Record<MetricKey, ChartPoint[]>;
  const contributors = {} as Record<MetricKey, SocialPlatform[]>;

  for (const metric of Object.keys(METRIC_FIELD) as MetricKey[]) {
    const field = METRIC_FIELD[metric];
    const contributing = new Set<SocialPlatform>();
    series[metric] = days.map((day) => {
      const point: ChartPoint = { day };
      let total = 0;
      let any = false;
      for (const p of platforms) {
        const row = byKey.get(`${day}|${p}`);
        const v = row ? (row[field] as number | null) : null;
        if (typeof v === "number") {
          point[p] = v;
          total += v;
          any = true;
          contributing.add(p);
        } else {
          point[p] = null;
        }
      }
      point.total = any ? total : null;
      return point;
    });
    contributors[metric] = platforms.filter((p) => contributing.has(p));
  }

  return { platforms, series, contributors };
}

export type SocialsTiles = {
  /** Follows GAINED during the period (gross, summed across platforms) —
   *  matches Business Suite's "Follows", not a running total. */
  follows_gained: number | null;
  impressions: number | null;
  engagements: number | null;
  profile_visits: number | null;
  link_clicks: number | null;
};

export type SocialsSummary = {
  periodLabel: string;
  tiles: SocialsTiles;
  /** Connected platform SERIES count (meta = FB + IG). Drives the empty state. */
  connectedCount: number;
  /** LinkedIn has a credential row but is pending API approval. */
  pendingLinkedin: boolean;
};

/**
 * Period rollup for the /socials tiles, computed from social_daily_metrics
 * over [start, end]. Additive metrics are summed across the window; followers
 * is the latest end-of-day absolute per platform (carried forward), summed.
 */
export async function fetchSocialsSummary(args: {
  clientId: string;
  start: string;
  end: string;
  periodLabel: string;
}): Promise<SocialsSummary> {
  const supabase = createAdminClient();
  const { accountOr } = await resolveAccountScope(supabase, args.clientId);

  // Connected platforms from credentials (so the empty state reflects "is
  // anything connected", independent of whether the range has data yet).
  const { data: credRows } = await supabase
    .from("client_social_credentials")
    .select("platform, ig_user_id")
    .eq("client_id", args.clientId);
  let connectedCount = 0;
  let pendingLinkedin = false;
  for (const r of (credRows ?? []) as Array<{ platform: string; ig_user_id: string | null }>) {
    if (r.platform === "linkedin") { pendingLinkedin = true; continue; }
    if (r.platform === "meta") connectedCount += 1 + (r.ig_user_id ? 1 : 0);
    else connectedCount += 1;
  }

  const rows = await fetchSocialDailyRows({ clientId: args.clientId, start: args.start, end: args.end, accountOr });

  // Additive metrics → sum non-null values across the window (null if none).
  const sumOf = (pick: (r: SocialDailyRow) => number | null): number | null => {
    let any = false;
    let total = 0;
    for (const r of rows) {
      const v = pick(r);
      if (typeof v === "number") { any = true; total += v; }
    }
    return any ? total : null;
  };

  return {
    periodLabel: args.periodLabel,
    tiles: {
      // Follows gained = sum of gross daily new follows across the window.
      // (Additive → changes with the range, unlike the old absolute total
      // that was broken for past ranges.)
      follows_gained: sumOf((r) => r.follows_gained),
      impressions: sumOf((r) => r.impressions),
      engagements: sumOf((r) => r.engagements),
      profile_visits: sumOf((r) => r.profile_visits),
      link_clicks: sumOf((r) => r.link_clicks),
    },
    connectedCount,
    pendingLinkedin,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Consolidated analytics for the explorer: per-metric totals + period-over-
// period % change + daily series + per-platform breakdown (each with its own
// % change). One call powers the tiles, chart, and breakdown table.

export type PlatformBreakdownRow = {
  platform: SocialPlatform;
  total: number;
  changePct: number | null;
  /** Absolute # change (followers gained). Only set for the followers metric. */
  changeAbs?: number | null;
  /** Followers only: this platform's curve for the range is partly/ wholly
   *  back-projected (e.g. Instagram beyond its 30-day real window). */
  estimated?: boolean;
};
export type MetricAnalytics = {
  total: number | null;
  changePct: number | null;
  /** Absolute # change for the period (followers metric only). */
  changeAbs?: number | null;
  series: ChartPoint[];
  breakdown: PlatformBreakdownRow[];
  /** True for followers — series/totals are ABSOLUTE counts, not period sums,
   *  so the UI shows the gained count. */
  isAbsolute?: boolean;
  /** Followers only: true when any contributing platform's curve is estimated. */
  estimated?: boolean;
};
/** TikTok recent-video aggregates for the selected range. TikTok has no
 *  per-day metrics, so these are computed from the latest recent-video
 *  snapshot, filtered to videos POSTED within the range (by create_time). */
export type TiktokVideoStats = {
  videosPosted: number;
  totalViews: number;
  avgViews: number | null;
  engRatePct: number | null;
};
/** Per-platform SHARES + SAVES totals for the breakdown tiles (migration 030).
 *  Not chartable metrics (no daily series): shares come from social_posts for
 *  FB/IG/TikTok + social_daily_metrics for YouTube; saves from social_posts for
 *  Instagram only (the one platform whose API exposes it). Null where a platform
 *  reports nothing (or the columns aren't migrated yet — read degrades to null). */
export type PostAggregateRow = {
  shares: number | null;
  sharesChangePct: number | null;
  saves: number | null;
  savesChangePct: number | null;
};
export type SocialsAnalytics = {
  metrics: Record<MetricKey, MetricAnalytics>;
  connectedCount: number;
  pendingLinkedin: boolean;
  /** TikTok content aggregates (null when no snapshot / TikTok not connected). */
  tiktok: TiktokVideoStats | null;
  /** Per-platform shares/saves totals for the breakdown tiles. A platform absent
   *  from the map has no shares/saves to show. */
  postAggregates: Partial<Record<SocialPlatform, PostAggregateRow>>;
};

const METRIC_FIELDS: Record<MetricKey, keyof SocialDailyRow> = {
  follows_gained: "follows_gained",
  impressions: "impressions",
  engagements: "engagements",
  profile_visits: "profile_visits",
  link_clicks: "link_clicks",
  reach: "reach",                  // Instagram (sum of daily reach over range)
  watch_time: "watch_time_minutes", // YouTube (minutes)
};

function pctChange(cur: number, prev: number): number | null {
  if (!prev || prev <= 0) return null; // no baseline → no meaningful %
  return ((cur - prev) / prev) * 100;
}

type TiktokVideoRow = { create_time: number; view_count: number; like_count: number; comment_count: number; share_count: number };

/** TikTok content aggregates for [start, end], from the latest recent-video
 *  snapshot, filtered to videos POSTED in the range. Each video's stats are
 *  its CURRENT cumulative totals (TikTok has no per-day data) — accurate for
 *  recent ranges; older videos have accrued more views since. */
async function fetchTiktokVideoStats(
  supabase: ReturnType<typeof createAdminClient>, clientId: string, start: string, end: string,
  activeTiktokId: string | null,
): Promise<TiktokVideoStats | null> {
  if (!activeTiktokId) return null; // TikTok not connected → nothing to show.
  const { data } = await supabase
    .from("client_tiktok_videos").select("videos, account_id").eq("client_id", clientId).maybeSingle();
  const snap = data as { videos?: TiktokVideoRow[]; account_id?: string | null } | null;
  // The single-row snapshot is overwritten each daily pull, so it should reflect
  // the connected account — but right after a switch it may still hold the OLD
  // account's videos until the next pull. Gate on account_id so a stale snapshot
  // stays dormant instead of mis-attributing another account's videos.
  if (!snap || snap.account_id !== activeTiktokId) return null;
  const vids = snap.videos;
  if (!vids || vids.length === 0) return null;
  const startSec = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1000);
  const endSec = Math.floor(Date.parse(`${end}T23:59:59Z`) / 1000);
  const inRange = vids.filter((v) => typeof v.create_time === "number" && v.create_time >= startSec && v.create_time <= endSec);
  const totalViews = inRange.reduce((s, v) => s + (v.view_count || 0), 0);
  const totalEng = inRange.reduce((s, v) => s + (v.like_count || 0) + (v.comment_count || 0) + (v.share_count || 0), 0);
  return {
    videosPosted: inRange.length,
    totalViews,
    avgViews: inRange.length ? Math.round(totalViews / inRange.length) : null,
    engRatePct: totalViews > 0 ? (totalEng / totalViews) * 100 : null,
  };
}

/** Per-platform shares + saves sums from social_posts over [loIso, hiIso],
 *  account-scoped. `saw*` flags distinguish "no posts / all null" (→ null, tile
 *  hidden) from a genuine 0. Defensive: a read error (e.g. the `saves` column
 *  not yet migrated) degrades to an empty map so the breakdown still renders
 *  without the new tiles rather than throwing. */
type ShareSaveSums = { shares: number; saves: number; sawShares: boolean; sawSaves: boolean };
async function fetchPostShareSaveSums(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string, accountOr: string | null, loIso: string, hiIso: string,
): Promise<Map<SocialPlatform, ShareSaveSums>> {
  const out = new Map<SocialPlatform, ShareSaveSums>();
  if (accountOr === null) return out;
  try {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("social_posts")
        .select("platform, shares, saves")
        .eq("client_id", clientId)
        .or(accountOr)
        .gte("posted_at", loIso)
        .lte("posted_at", hiIso)
        .order("posted_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ platform: SocialPlatform; shares: number | null; saves: number | null }>;
      for (const r of rows) {
        const cur = out.get(r.platform) ?? { shares: 0, saves: 0, sawShares: false, sawSaves: false };
        if (typeof r.shares === "number") { cur.shares += r.shares; cur.sawShares = true; }
        if (typeof r.saves === "number") { cur.saves += r.saves; cur.sawSaves = true; }
        out.set(r.platform, cur);
      }
      if (rows.length < PAGE) break;
    }
  } catch (e) {
    console.error("[socials] share/save aggregation failed (continuing without):", e instanceof Error ? e.message : e);
    return new Map();
  }
  return out;
}

/** Sum YouTube's discrete daily shares (social_daily_metrics.shares — written by
 *  the YT Analytics pull) over the day range, scoped to the active YouTube
 *  account. YouTube's per-post API has no share count, so its shares live here
 *  rather than in social_posts. Null when YouTube isn't connected, has no data,
 *  or the column isn't migrated yet (read degrades to null). */
async function fetchYoutubeDailyShares(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string, youtubeAccountId: string | null, start: string, end: string,
): Promise<number | null> {
  if (!youtubeAccountId) return null;
  try {
    const PAGE = 1000;
    let sum = 0; let any = false;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("social_daily_metrics")
        .select("shares")
        .eq("client_id", clientId)
        .eq("platform", "youtube")
        .eq("account_id", youtubeAccountId)
        .gte("day", start)
        .lte("day", end)
        .order("day", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ shares: number | null }>;
      for (const r of rows) { if (typeof r.shares === "number") { sum += r.shares; any = true; } }
      if (rows.length < PAGE) break;
    }
    return any ? sum : null;
  } catch (e) {
    console.error("[socials] YouTube daily shares read failed (continuing without):", e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchSocialsAnalyticsRaw(args: {
  clientId: string;
  start: string;
  end: string;
  compStart: string;
  compEnd: string;
}): Promise<SocialsAnalytics> {
  const supabase = createAdminClient();
  const { active, accountOr } = await resolveAccountScope(supabase, args.clientId);
  const [credRes, curRows, prevRows, followerRecon] = await Promise.all([
    supabase.from("client_social_credentials").select("platform, ig_user_id").eq("client_id", args.clientId),
    fetchSocialDailyRows({ clientId: args.clientId, start: args.start, end: args.end, accountOr }),
    fetchSocialDailyRows({ clientId: args.clientId, start: args.compStart, end: args.compEnd, accountOr }),
    // Followers reconstruction: rows from the range START through the LATEST
    // stored day, so we can anchor at each platform's most recent absolute
    // snapshot (FB/IG only store the absolute on "today") and walk it back into
    // a past range. See buildFollowersAnalytics.
    fetchFollowerReconRows(args.clientId, args.start, accountOr),
  ]);

  let connectedCount = 0;
  let pendingLinkedin = false;
  for (const r of (credRes.data ?? []) as Array<{ platform: string; ig_user_id: string | null }>) {
    if (r.platform === "linkedin") { pendingLinkedin = true; continue; }
    if (r.platform === "meta") connectedCount += 1 + (r.ig_user_id ? 1 : 0);
    else connectedCount += 1;
  }

  const platforms = [...new Set(curRows.map((r) => r.platform))].sort() as SocialPlatform[];
  const days = [...new Set(curRows.map((r) => r.day))].sort();
  const curByKey = new Map<string, SocialDailyRow>();
  for (const r of curRows) curByKey.set(`${r.day}|${r.platform}`, r);

  // ── Coverage gate. A platform only contributes to a metric if it was being
  //    tracked from the START of the selected range — otherwise we never
  //    measured its baseline and would be inventing data. (TikTok is
  //    snapshot-diff / forward-only: for any range older than a few days its
  //    earliest stored day is AFTER the start, so it gets excluded rather than
  //    drawn as a flat fabricated follower line.) We check the LEADING edge
  //    only: trailing reporting lag — YouTube is ~2 days behind — must not drop
  //    a platform whose baseline we do have.
  const minDayByPlat = new Map<SocialPlatform, string | null>(
    await Promise.all(
      platforms.map(async (p) => {
        const { data } = await supabase
          .from("social_daily_metrics")
          .select("day")
          .eq("client_id", args.clientId)
          .eq("platform", p)
          .eq("account_id", active.get(p) ?? UNKNOWN_ACCOUNT)
          .order("day", { ascending: true })
          .limit(1)
          .maybeSingle();
        return [p, (data as { day: string } | null)?.day ?? null] as const;
      }),
    ),
  );
  // yyyy-MM-dd strings compare correctly lexicographically.
  const fullCurrent = (p: SocialPlatform) => {
    const md = minDayByPlat.get(p);
    return md != null && md <= args.start;
  };
  const fullPrev = (p: SocialPlatform) => {
    const md = minDayByPlat.get(p);
    return md != null && md <= args.compStart;
  };

  const metrics = {} as Record<MetricKey, MetricAnalytics>;
  for (const metric of Object.keys(METRIC_FIELDS) as MetricKey[]) {
    if (metric === "follows_gained") continue; // computed as ABSOLUTE followers below
    const field = METRIC_FIELDS[metric];

    // Sum the current window per platform + note who reported anything.
    const curPlatTotal = new Map<SocialPlatform, number>();
    for (const r of curRows) {
      const v = r[field] as number | null;
      if (typeof v === "number") curPlatTotal.set(r.platform, (curPlatTotal.get(r.platform) ?? 0) + v);
    }
    // Included = reported a value AND has full current-period coverage.
    const included = platforms.filter((p) => curPlatTotal.has(p) && fullCurrent(p));

    const series: ChartPoint[] = days.map((day) => {
      const point: ChartPoint = { day };
      let total = 0;
      let any = false;
      for (const p of included) {
        const v = curByKey.get(`${day}|${p}`)?.[field] as number | null | undefined;
        if (typeof v === "number") {
          point[p] = v;
          total += v;
          any = true;
        } else {
          point[p] = null;
        }
      }
      point.total = any ? total : null;
      return point;
    });

    const prevPlatTotal = new Map<SocialPlatform, number>();
    for (const r of prevRows) {
      const v = r[field] as number | null;
      if (typeof v === "number") prevPlatTotal.set(r.platform, (prevPlatTotal.get(r.platform) ?? 0) + v);
    }

    const curTotal = included.length
      ? included.reduce((s, p) => s + (curPlatTotal.get(p) ?? 0), 0)
      : null;
    // Aggregate % only when EVERY included platform also fully covers the
    // comparison period — otherwise the baseline is apples-to-oranges.
    const aggPctOk = included.length > 0 && included.every(fullPrev);
    const prevTotal = included.reduce((s, p) => s + (prevPlatTotal.get(p) ?? 0), 0);

    metrics[metric] = {
      total: curTotal,
      changePct: curTotal === null || !aggPctOk ? null : pctChange(curTotal, prevTotal),
      series,
      breakdown: included.map((p) => ({
        platform: p,
        total: curPlatTotal.get(p) ?? 0,
        // Per-platform % needs full coverage of BOTH periods for that platform.
        changePct: fullPrev(p) ? pctChange(curPlatTotal.get(p) ?? 0, prevPlatTotal.get(p) ?? 0) : null,
      })),
    };
  }

  // Followers: only platforms with a known baseline at the period start.
  metrics.follows_gained = buildFollowersAnalytics(followerRecon, platforms.filter(fullCurrent), days);

  // TikTok recent-video aggregates — period-aware via create_time on the
  // latest snapshot (lib/etl/social.ts writes client_tiktok_videos). Scoped to
  // the ACTIVE TikTok account: a snapshot left behind by a switched-away account
  // is dormant (null → hidden). null id = TikTok not connected.
  const tiktok = await fetchTiktokVideoStats(
    supabase, args.clientId, args.start, args.end, active.get("tiktok") ?? null,
  );

  // Shares + saves for the breakdown tiles (migration 030). Shares: FB/IG/TikTok
  // from social_posts, YouTube from its discrete daily metric; saves: IG only.
  // Windowed by posted_at as UTC day bounds (matching fetchTiktokVideoStats in
  // this same function), with a comparison period for the % change badge.
  const curLo = `${args.start}T00:00:00.000Z`;
  const curHi = `${args.end}T23:59:59.999Z`;
  const prevLo = `${args.compStart}T00:00:00.000Z`;
  const prevHi = `${args.compEnd}T23:59:59.999Z`;
  const ytId = active.get("youtube") ?? null;
  const [curSS, prevSS, ytSharesCur, ytSharesPrev] = await Promise.all([
    fetchPostShareSaveSums(supabase, args.clientId, accountOr, curLo, curHi),
    fetchPostShareSaveSums(supabase, args.clientId, accountOr, prevLo, prevHi),
    fetchYoutubeDailyShares(supabase, args.clientId, ytId, args.start, args.end),
    fetchYoutubeDailyShares(supabase, args.clientId, ytId, args.compStart, args.compEnd),
  ]);

  const postAggregates: Partial<Record<SocialPlatform, PostAggregateRow>> = {};
  // FB/IG/TikTok shares (+ IG saves) from social_posts.
  for (const p of ["meta_facebook", "meta_instagram", "tiktok"] as SocialPlatform[]) {
    const cur = curSS.get(p);
    const prev = prevSS.get(p);
    const shares = cur?.sawShares ? cur.shares : null;
    const sharesChangePct =
      cur?.sawShares && prev?.sawShares ? pctChange(cur.shares, prev.shares) : null;
    // Saves: Instagram only — the sole platform whose API reports it.
    const saves = p === "meta_instagram" && cur?.sawSaves ? cur.saves : null;
    const savesChangePct =
      p === "meta_instagram" && cur?.sawSaves && prev?.sawSaves ? pctChange(cur.saves, prev.saves) : null;
    if (shares != null || saves != null) postAggregates[p] = { shares, sharesChangePct, saves, savesChangePct };
  }
  // YouTube shares — from the discrete daily metric (no per-post share count).
  if (ytSharesCur != null) {
    postAggregates.youtube = {
      shares: ytSharesCur,
      sharesChangePct: ytSharesPrev != null ? pctChange(ytSharesCur, ytSharesPrev) : null,
      saves: null,
      savesChangePct: null,
    };
  }

  return { metrics, connectedCount, pendingLinkedin, tiktok, postAggregates };
}

/** Minimal columns needed to reconstruct the absolute follower curve. */
type FollowerReconRow = Pick<SocialDailyRow, "platform" | "day" | "followers" | "follows_gained">;

/** Rows from `start` through the LATEST stored day (no upper bound), so the
 *  absolute-follower anchor is reachable even for a range that ends in the
 *  past. Only the columns the reconstruction needs. */
async function fetchFollowerReconRows(
  clientId: string, start: string, accountOr: string | null,
): Promise<FollowerReconRow[]> {
  if (accountOr === null) return [];
  const supabase = createAdminClient();
  // Paginate — this spans [start, today] across all platforms, easily >1000
  // rows for long ranges. Critically, the NEWEST rows carry the absolute
  // follower anchor (FB/IG store it only on "today"); dropping them via the
  // 1000-row cap would silently strip a platform from the chart.
  const PAGE = 1000;
  const out: FollowerReconRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("social_daily_metrics")
      .select("platform, day, followers, follows_gained")
      .eq("client_id", clientId)
      .or(accountOr)
      .gte("day", start)
      .order("day", { ascending: true })
      .order("platform", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`social_daily_metrics followers recon read failed: ${error.message}`);
    const rows = (data ?? []) as FollowerReconRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Followers as ABSOLUTE counts (not a period sum).
 *
 * The absolute `followers` is only stored on each platform's LATEST snapshot
 * (FB/IG write it onto "today" only; YouTube back-computes every day). So we
 * anchor at each platform's most recent KNOWN absolute (typically today, after
 * the range) and walk BACKWARD to rebuild the curve across the range:
 *
 *   - For days we DID measure `follows_gained` → real: abs[d-1] = abs[d] − gained[d].
 *     (Facebook = ~2y real, YouTube = full real.)
 *   - For days that PREDATE our gained data → ESTIMATE: decay by the measured
 *     recent daily growth factor (abs[d-1] = abs[d] / g). Instagram's
 *     `follower_count` is 30-day-capped, so for older ranges its curve is
 *     back-projected from current count + recent growth — the same estimation
 *     Plannable / Socialinsider use (no historical IG follower data exists in
 *     any API). `estimated` flags when this kicked in.
 *
 *   - tile / breakdown "Followers" value = absolute at the range END;
 *     `changeAbs` / `changePct` = net change & growth across the range (read
 *     straight off the curve, so it works for measured AND estimated spans).
 */
function buildFollowersAnalytics(
  reconRows: FollowerReconRow[], platforms: SocialPlatform[], rangeDays: string[],
): MetricAnalytics {
  const idx = new Map<string, FollowerReconRow>();
  for (const r of reconRows) idx.set(`${r.day}|${r.platform}`, r);
  const allDays = [...new Set(reconRows.map((r) => r.day))].sort(); // range + bridge to anchor

  const absByPlatDay = new Map<SocialPlatform, Map<string, number>>();
  const estimatedByPlat = new Map<SocialPlatform, boolean>();
  const contributors: SocialPlatform[] = [];

  for (const p of platforms) {
    const pDays = allDays.filter((d) => idx.has(`${d}|${p}`));
    if (pDays.length === 0) continue;
    // Anchor: most recent day with a known absolute (usually today).
    let anchorIdx = -1;
    let anchorAbs = 0;
    for (let i = pDays.length - 1; i >= 0; i--) {
      const f = idx.get(`${pDays[i]}|${p}`)?.followers;
      if (typeof f === "number") { anchorAbs = f; anchorIdx = i; break; }
    }
    if (anchorIdx === -1) continue;
    contributors.push(p);

    // Measured recent growth → a daily compound FACTOR, used to back-project
    // days that predate our `follows_gained` data. Clamp to ≥1 (only project
    // growth, never invent a higher past from a recent dip; 1 = hold flat).
    let realGainedSum = 0;
    let realGainedDays = 0;
    for (const d of pDays) {
      const g = idx.get(`${d}|${p}`)?.follows_gained;
      if (typeof g === "number") { realGainedSum += g; realGainedDays += 1; }
    }
    const realStart = anchorAbs - realGainedSum;
    const growthFactor =
      realGainedDays > 0 && realStart > 0 && anchorAbs > realStart
        ? Math.pow(anchorAbs / realStart, 1 / realGainedDays)
        : 1;

    const m = new Map<string, number>();
    let running = anchorAbs;
    let usedEstimate = false;
    for (let i = anchorIdx; i >= 0; i--) {
      m.set(pDays[i], Math.round(running));
      const g = idx.get(`${pDays[i]}|${p}`)?.follows_gained;
      if (typeof g === "number") {
        running -= g;                 // measured
      } else if (growthFactor > 1) {
        running /= growthFactor;      // estimated (geometric decay backward)
        usedEstimate = true;
      }                                // else: hold flat
      if (running < 0) running = 0;
    }
    absByPlatDay.set(p, m);
    estimatedByPlat.set(p, usedEstimate);
  }

  // Display series across the range. Carry-forward / back-fill null gaps —
  // a null in a stacked/overlaid area re-breaks the line.
  const series: ChartPoint[] = rangeDays.map((day) => {
    const point: ChartPoint = { day };
    for (const p of contributors) {
      const v = absByPlatDay.get(p)?.get(day);
      point[p] = typeof v === "number" ? v : null;
    }
    return point;
  });
  for (const p of contributors) {
    let last: number | null = null;
    for (const pt of series) {
      const v = pt[p];
      if (typeof v === "number") last = v;
      else if (last !== null) pt[p] = last;
    }
    const firstKnown = series.find((pt) => typeof pt[p] === "number")?.[p];
    if (typeof firstKnown === "number") for (const pt of series) { if (pt[p] == null) pt[p] = firstKnown; }
  }
  for (const pt of series) {
    let total = 0; let any = false;
    for (const p of contributors) { const v = pt[p]; if (typeof v === "number") { total += v; any = true; } }
    pt.total = any ? total : null;
  }

  // Net change over the range, read straight off the (real + estimated) curve.
  const first = series[0];
  const last = series[series.length - 1];
  const startOf = (p: SocialPlatform) => (typeof first?.[p] === "number" ? (first[p] as number) : 0);
  const endOf = (p: SocialPlatform) => (typeof last?.[p] === "number" ? (last[p] as number) : 0);
  const growthPct = (endA: number, startA: number): number | null =>
    startA > 0 ? ((endA - startA) / startA) * 100 : null;

  const totalEnd = contributors.reduce((s, p) => s + endOf(p), 0);
  const totalStart = contributors.reduce((s, p) => s + startOf(p), 0);

  return {
    isAbsolute: true,
    estimated: contributors.some((p) => estimatedByPlat.get(p)),
    total: contributors.length ? totalEnd : null,
    changeAbs: contributors.length ? totalEnd - totalStart : null,
    changePct: contributors.length ? growthPct(totalEnd, totalStart) : null,
    series,
    breakdown: contributors.map((p) => ({
      platform: p,
      total: endOf(p),
      changeAbs: endOf(p) - startOf(p),
      changePct: growthPct(endOf(p), startOf(p)),
      estimated: estimatedByPlat.get(p) ?? false,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Top performing content — individual posts for the /socials cards, read from
// social_posts (migration 026; written by lib/etl/social-posts.ts).

/** social_posts columns the cards need. */
type SocialPostRow = {
  platform: SocialPlatform;
  post_id: string;
  posted_at: string;
  permalink: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  media_type: TopContentItem["mediaType"] | null;
  reach_kind: TopContentItem["reach"]["kind"] | null;
  reach: number | null;
  engagements: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};

const POST_COLS =
  "platform, post_id, posted_at, permalink, thumbnail_url, caption, media_type, reach_kind, reach, engagements, likes, comments, shares";

/**
 * Posts PUBLISHED in [start, end] for the "Top performing content" cards.
 *
 * The <TopContent/> component re-ranks the WHOLE `items` array client-side when
 * the user toggles Impressions ⇄ Engagements, then slices to its display limit.
 * So a single ORDER BY would hand back the wrong set the moment they toggle —
 * the leaders by reach aren't the leaders by engagements. We therefore fetch a
 * candidate POOL = union of (top-by-reach) and (top-by-engagements), big enough
 * that the true top-N of EITHER metric is always present. Nulls sort last so a
 * post whose reach we couldn't fetch (FB/IG insights gap) still ranks on
 * engagements. accountName isn't stored per-post — we join it from the client's
 * credentials (one Meta grant carries both the FB page name and IG handle).
 */
async function fetchTopContentRaw(args: {
  clientId: string;
  start: string; // yyyy-MM-dd inclusive
  end: string;   // yyyy-MM-dd inclusive
  /** IANA tz the [start,end] window is interpreted in (default UTC). Matches the
   *  cadence loader so the same selected period covers the same posts everywhere. */
  timezone?: string | null;
  /** Cards the UI shows per metric (default 3). Sets the candidate pool depth. */
  limit?: number;
}): Promise<TopContentItem[]> {
  const supabase = createAdminClient();
  const { accountOr } = await resolveAccountScope(supabase, args.clientId);
  if (accountOr === null) return [];
  const limit = args.limit ?? 3;
  // Pool per ordering — generous headroom over the display limit so toggling
  // sort (or bumping the limit later) never reveals a truncated ranking.
  const pool = Math.max(limit * 6, 24);
  // Window edges as the UTC instants of the LOCAL day boundaries, so this
  // selected period covers the same posts as the cadence heatmap (which buckets
  // in local tz). A UTC-fixed window would clip/leak the tz offset's worth of
  // edge posts for non-UTC clients. Resolves to the exact old values for UTC.
  const tz = args.timezone || "UTC";
  const [sy, sm, sd] = args.start.split("-").map(Number);
  const [ey, em, ed] = args.end.split("-").map(Number);
  const lo = zonedWallTimeToUtcIso(sy, sm, sd, 0, 0, 0, 0, tz);
  const hi = zonedWallTimeToUtcIso(ey, em, ed, 23, 59, 59, 999, tz);

  const inRange = () =>
    supabase
      .from("social_posts")
      .select(POST_COLS)
      .eq("client_id", args.clientId)
      .or(accountOr)
      .gte("posted_at", lo)
      .lte("posted_at", hi);

  const [byReach, byEng, names] = await Promise.all([
    inRange().order("reach", { ascending: false, nullsFirst: false }).limit(pool),
    inRange().order("engagements", { ascending: false, nullsFirst: false }).limit(pool),
    accountNamesByPlatform(supabase, args.clientId),
  ]);
  if (byReach.error) throw new Error(`social_posts read failed: ${byReach.error.message}`);
  if (byEng.error) throw new Error(`social_posts read failed: ${byEng.error.message}`);

  // Union the two orderings, de-duped on (platform, post_id).
  const seen = new Map<string, SocialPostRow>();
  for (const r of [...(byReach.data ?? []), ...(byEng.data ?? [])] as SocialPostRow[]) {
    seen.set(`${r.platform}:${r.post_id}`, r);
  }

  return [...seen.values()].map((r) => ({
    id: `${r.platform}:${r.post_id}`,
    platform: r.platform,
    accountName: names.get(r.platform) ?? PLATFORM_FALLBACK_NAME[r.platform],
    postedAt: r.posted_at,
    permalink: r.permalink ?? "",
    thumbnailUrl: r.thumbnail_url,
    mediaType: r.media_type ?? "image",
    caption: r.caption ?? "",
    reach: { kind: r.reach_kind ?? "unknown", value: r.reach ?? 0 },
    engagements: r.engagements ?? 0,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
  }));
}

/**
 * Posts published in [start, end] for the <ContentLibrary/> catalogue — a
 * media-type-bucketed list (no performance metrics). The component shows the
 * latest 20 across all types plus up to 10 of EACH type, so we hand back the
 * superset: latest 20 (any type) ∪ latest 10 of each media bucket, deduped on
 * (platform, post_id). Ordered by recency, not reach — this is a catalogue, not
 * a ranking. Per-bucket queries (not one big slice) so a sparse type like
 * carousels still reaches 10 even when recent activity is mostly video.
 */
async function fetchContentLibraryRaw(args: {
  clientId: string;
  start: string; // yyyy-MM-dd inclusive
  end: string;   // yyyy-MM-dd inclusive
  /** IANA tz the [start,end] window is interpreted in (default UTC). Matches the
   *  cadence loader so the same selected period covers the same posts everywhere. */
  timezone?: string | null;
}): Promise<ContentItem[]> {
  const supabase = createAdminClient();
  const { accountOr } = await resolveAccountScope(supabase, args.clientId);
  if (accountOr === null) return [];
  // Window edges as the UTC instants of the LOCAL day boundaries — see
  // fetchTopContentRaw / the cadence loader. UTC client → exact old values.
  const tz = args.timezone || "UTC";
  const [sy, sm, sd] = args.start.split("-").map(Number);
  const [ey, em, ed] = args.end.split("-").map(Number);
  const lo = zonedWallTimeToUtcIso(sy, sm, sd, 0, 0, 0, 0, tz);
  const hi = zonedWallTimeToUtcIso(ey, em, ed, 23, 59, 59, 999, tz);

  const inRange = () =>
    supabase
      .from("social_posts")
      .select(POST_COLS)
      .eq("client_id", args.clientId)
      .or(accountOr)
      .gte("posted_at", lo)
      .lte("posted_at", hi)
      .order("posted_at", { ascending: false });

  const [anyType, reels, videos, posts, carousels, names] = await Promise.all([
    inRange().limit(20),
    inRange().eq("media_type", "reel").limit(10),
    inRange().eq("media_type", "video").limit(10),
    inRange().in("media_type", ["image", "text"]).limit(10),
    inRange().eq("media_type", "carousel").limit(10),
    accountNamesByPlatform(supabase, args.clientId),
  ]);
  for (const r of [anyType, reels, videos, posts, carousels]) {
    if (r.error) throw new Error(`social_posts read failed: ${r.error.message}`);
  }

  const seen = new Map<string, SocialPostRow>();
  for (const r of [
    ...(anyType.data ?? []), ...(reels.data ?? []), ...(videos.data ?? []),
    ...(posts.data ?? []), ...(carousels.data ?? []),
  ] as SocialPostRow[]) {
    seen.set(`${r.platform}:${r.post_id}`, r);
  }

  return [...seen.values()].map((r) => ({
    id: `${r.platform}:${r.post_id}`,
    platform: r.platform,
    accountName: names.get(r.platform) ?? PLATFORM_FALLBACK_NAME[r.platform],
    postedAt: r.posted_at,
    permalink: r.permalink ?? "",
    thumbnailUrl: r.thumbnail_url,
    mediaType: r.media_type ?? "image",
    caption: r.caption ?? "",
    reach: { kind: r.reach_kind ?? "unknown", value: r.reach ?? 0 },
    engagements: r.engagements ?? 0,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
  }));
}

const PLATFORM_FALLBACK_NAME: Record<SocialPlatform, string> = {
  meta_facebook: "Facebook",
  meta_instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

/** Display name per post platform, from the client's credentials. One 'meta'
 *  credential row carries BOTH the Facebook page name and the IG handle. */
async function accountNamesByPlatform(
  supabase: ReturnType<typeof createAdminClient>, clientId: string,
): Promise<Map<SocialPlatform, string>> {
  const { data } = await supabase
    .from("client_social_credentials")
    .select("platform, fb_page_name, ig_username, youtube_channel_title, tiktok_display_name, tiktok_username")
    .eq("client_id", clientId);
  const out = new Map<SocialPlatform, string>();
  for (const r of (data ?? []) as Array<{
    platform: string;
    fb_page_name: string | null; ig_username: string | null;
    youtube_channel_title: string | null;
    tiktok_display_name: string | null; tiktok_username: string | null;
  }>) {
    if (r.platform === "meta") {
      if (r.fb_page_name) out.set("meta_facebook", r.fb_page_name);
      if (r.ig_username) out.set("meta_instagram", r.ig_username);
    } else if (r.platform === "youtube") {
      if (r.youtube_channel_title) out.set("youtube", r.youtube_channel_title);
    } else if (r.platform === "tiktok") {
      const name = r.tiktok_display_name ?? r.tiktok_username;
      if (name) out.set("tiktok", name);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Content mix — powers the "Posting cadence" heatmap + "Content type" donut.
// Both read the same set of posts in [start, end], so one query feeds both:
//   - cadence: a 6×7 matrix (4-hour time buckets × Mon→Sun), counting posts by
//     when they went live IN THE CLIENT'S LOCAL TIMEZONE (so "9am" means 9am to
//     the agency, not UTC).
//   - byType: post counts per media type, biggest first, for the donut.

/** 4-hour time buckets. Label marks the START of each bucket (row r covers
 *  [4r, 4r+4) local hours). */
const CADENCE_ROW_LABELS = ["12 AM", "4 AM", "8 AM", "12 PM", "4 PM", "8 PM"];
const CADENCE_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Intl weekday short names → column index (Mon-led, matching the labels above).
const WEEKDAY_COL: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

/**
 * UTC offset (ms; how far AHEAD of UTC the wall clock runs) for an instant in
 * an IANA zone — positive east of UTC, 0 for an unknown/invalid zone. Built
 * from the same formatToParts the cadence bucketing uses, so the window and
 * the buckets agree on the zone.
 */
function tzOffsetMs(instant: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant);
  } catch {
    return 0; // unknown zone → treat as UTC
  }
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
  let hour = m.hour;
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  const asUtc = Date.UTC(m.year, m.month - 1, m.day, hour, m.minute, m.second);
  return asUtc - instant.getTime();
}

/**
 * The UTC instant (ISO string) for a wall-clock time in `timeZone`. Read the
 * naive components as if UTC, measure the zone's offset at that approximate
 * instant, subtract it, then re-measure once at the corrected instant so a DST
 * shift falling between the two reads is absorbed. This lets the cadence window
 * edges line up with the local-tz bucketing below — a UTC-fixed window would
 * clip the offset's worth of evening posts on the last local day and bleed in
 * late posts from the day before `start`.
 */
function zonedWallTimeToUtcIso(
  y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number,
  timeZone: string,
): string {
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const off1 = tzOffsetMs(new Date(naiveUtc), timeZone);
  const off2 = tzOffsetMs(new Date(naiveUtc - off1), timeZone);
  return new Date(naiveUtc - off2).toISOString();
}

export type SocialsContentMix = {
  total: number;
  byType: ContentTypeSlice[];
  /** cadence[row][col]: row = 4-hour bucket (0..5), col = day (Mon..Sun). */
  cadence: number[][];
  rowLabels: string[];
  dayLabels: string[];
};

/**
 * Aggregate posts in [start, end] into the cadence matrix + content-type
 * counts. Reads only the two columns both views need (posted_at, media_type),
 * paginated past PostgREST's 1000-row cap. Day/time bucketing uses the client's
 * timezone via Intl so the heatmap reads in the agency's local clock.
 */
async function fetchSocialsContentMixRaw(args: {
  clientId: string;
  start: string; // yyyy-MM-dd inclusive
  end: string;   // yyyy-MM-dd inclusive
  timezone?: string | null;
}): Promise<SocialsContentMix> {
  const supabase = createAdminClient();
  const { accountOr } = await resolveAccountScope(supabase, args.clientId);
  if (accountOr === null) {
    return {
      total: 0,
      byType: [],
      cadence: CADENCE_ROW_LABELS.map(() => new Array(7).fill(0)),
      rowLabels: CADENCE_ROW_LABELS,
      dayLabels: CADENCE_DAY_LABELS,
    };
  }
  // Window edges as the UTC instants of the LOCAL day boundaries (same tz the
  // cadence buckets use below). A UTC-fixed "...T00:00:00Z / ...T23:59:59Z"
  // window is offset from the local calendar day for non-UTC clients — it would
  // drop evening posts on the last local day and bleed in late posts from the
  // day before `start`. For a UTC client this resolves to the exact old values.
  const tz = args.timezone || "UTC";
  const [sy, sm, sd] = args.start.split("-").map(Number);
  const [ey, em, ed] = args.end.split("-").map(Number);
  const lo = zonedWallTimeToUtcIso(sy, sm, sd, 0, 0, 0, 0, tz);
  const hi = zonedWallTimeToUtcIso(ey, em, ed, 23, 59, 59, 999, tz);

  // Pull every post in range (just the two fields we bucket on).
  const PAGE = 1000;
  const rows: Array<{ posted_at: string; media_type: string | null }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("social_posts")
      .select("posted_at, media_type")
      .eq("client_id", args.clientId)
      .or(accountOr)
      .gte("posted_at", lo)
      .lte("posted_at", hi)
      .order("posted_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`social_posts content-mix read failed: ${error.message}`);
    const page = (data ?? []) as Array<{ posted_at: string; media_type: string | null }>;
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // Day/time parts in the client's local timezone. formatToParts gives us the
  // weekday + 24h hour in one pass; fall back to UTC if the tz is unset/invalid.
  let dtf: Intl.DateTimeFormat;
  try {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    });
  } catch {
    dtf = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", hour: "2-digit", hour12: false });
  }

  const cadence: number[][] = CADENCE_ROW_LABELS.map(() => new Array(7).fill(0));
  const typeCounts = new Map<ContentMediaType, number>();

  for (const r of rows) {
    // Content type.
    const t = (r.media_type ?? "image") as ContentMediaType;
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);

    // Cadence bucket.
    const d = new Date(r.posted_at);
    if (Number.isNaN(d.getTime())) continue;
    const parts = dtf.formatToParts(d);
    const wd = parts.find((p) => p.type === "weekday")?.value;
    let hour = Number(parts.find((p) => p.type === "hour")?.value);
    if (hour === 24) hour = 0; // some engines emit "24" for midnight
    const col = wd != null ? WEEKDAY_COL[wd] : undefined;
    if (col == null || Number.isNaN(hour)) continue;
    const row = Math.min(5, Math.floor(hour / 4));
    cadence[row][col] += 1;
  }

  const byType: ContentTypeSlice[] = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
  const total = byType.reduce((s, d) => s + d.count, 0);

  return {
    total,
    byType,
    cadence,
    rowLabels: CADENCE_ROW_LABELS,
    dayLabels: CADENCE_DAY_LABELS,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cached public entry points. Each wraps its *Raw loader in unstable_cache so a
// warm /socials navigation serves from the cross-request cache (REVALIDATE_SECONDS
// window) instead of re-querying Supabase, and tags it SOCIAL_CACHE_TAG so any
// mutation can bust the whole socials cache at once via revalidateTag. The Raw
// fns build their own admin client and take only serializable args (no cookies/
// headers) — which is what lets unstable_cache key + persist them. Key arrays are
// versioned (-vN): bump on any return-shape change so stale-shaped blobs aren't
// served from a warm cache after a deploy.

export const fetchSocialDateBounds = unstable_cache(
  fetchSocialDateBoundsRaw,
  ["socials-date-bounds-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [SOCIAL_CACHE_TAG] },
);

export const fetchSocialsAnalytics = unstable_cache(
  fetchSocialsAnalyticsRaw,
  // -v2: added postAggregates (shares/saves breakdown tiles, migration 030).
  ["socials-analytics-v2"],
  { revalidate: REVALIDATE_SECONDS, tags: [SOCIAL_CACHE_TAG] },
);

export const fetchTopContent = unstable_cache(
  fetchTopContentRaw,
  ["socials-top-content-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [SOCIAL_CACHE_TAG] },
);

export const fetchContentLibrary = unstable_cache(
  fetchContentLibraryRaw,
  ["socials-content-library-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [SOCIAL_CACHE_TAG] },
);

export const fetchSocialsContentMix = unstable_cache(
  fetchSocialsContentMixRaw,
  ["socials-content-mix-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: [SOCIAL_CACHE_TAG] },
);
