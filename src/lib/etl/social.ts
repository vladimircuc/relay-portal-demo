/**
 * Social daily ETL — writes per-day rows into `social_daily_metrics`
 * (migration 023). This is the durable backing store the /socials chart,
 * tiles, and date-range selector read from.
 *
 * Two entry points, both wrapped in withEtlRun() by their callers:
 *   - runSocialDailyPull({clientId})  → cron: re-pull a 7-day sliding window
 *     for every connected platform and upsert. Re-pulling a week catches
 *     late-arriving / revised data (views settle over 48–72h) — upsert on
 *     (client, platform, day) corrects the stored value.
 *   - runSocialBackfill({clientId, platform?}) → on-connect / manual: pull
 *     the deepest history each platform allows and upsert with source=
 *     'backfill'. Records progress in social_backfill_jobs.
 *
 * Metric semantics match the table (see migration 023):
 *   followers       = absolute end-of-day count (snapshot)
 *   followers_delta = net gained−lost that day (YouTube only)
 *   impressions / engagements / profile_visits / link_clicks = DAILY values
 *
 * History depth is platform-limited and that's expected:
 *   YouTube  — full (Analytics API, dimensions=day)
 *   Facebook — ~2y (Page insights period=day)
 *   Instagram— ~30d window cap, forward-only after
 *   TikTok   — none (snapshot only) → followers accumulate from connect date
 *   LinkedIn — pending API approval (skipped)
 *
 * Every platform fetch is wrapped so one platform's failure never aborts the
 * others — partial data still gets written and the run is still logged.
 */
import "server-only";
import { format, subDays, parseISO } from "date-fns";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret, setVaultSecret } from "@/lib/etl/vault";
import { refreshAccessToken as refreshYoutubeToken } from "@/lib/youtube-oauth";
import { refreshAccessToken as refreshTiktokToken } from "@/lib/tiktok-oauth";
import { META_API_VERSION } from "@/lib/meta-oauth";
import { activeAccountIds, UNKNOWN_ACCOUNT } from "@/lib/etl/social-accounts";
import type { EtlPullResult, EtlBreakdownItem } from "@/lib/etl/runs";

type Supa = ReturnType<typeof createAdminClient>;

export type SocialPlatform =
  | "meta_facebook"
  | "meta_instagram"
  | "youtube"
  | "tiktok"
  | "linkedin";

/** A recent TikTok video as stored in client_tiktok_videos.videos (JSONB).
 *  Stats are CURRENT cumulative totals. The cover/share_url/title fields let
 *  the posts pull reshape these into social_posts without a second TikTok
 *  token refresh. (The follower-stats reader in socials-timeseries only uses
 *  the count fields, so the added fields are backward-compatible.) */
export type TiktokVideo = {
  id: string;
  create_time: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  cover_image_url: string | null;
  share_url: string | null;
  title: string | null;
};

/** One upsertable row. All metric fields optional → normalized to null. */
type DailyRow = {
  client_id: string;
  platform: SocialPlatform;
  /** Stable platform account id this row belongs to (PK member; migration 028).
   *  fb_page_id / ig_user_id / youtube_channel_id / tiktok_open_id. */
  account_id: string;
  day: string; // yyyy-MM-dd
  followers?: number | null;
  followers_delta?: number | null;
  follows_gained?: number | null;
  impressions?: number | null;
  engagements?: number | null;
  profile_visits?: number | null;
  link_clicks?: number | null;
  reach?: number | null;               // daily unique reach (Instagram)
  watch_time_minutes?: number | null;  // daily minutes watched (YouTube)
  shares?: number | null;              // daily shares (YouTube, from YT Analytics)
  source: "backfill" | "cron" | "manual";
};

const G = `https://graph.facebook.com/${META_API_VERSION}`;
const YT_DATA = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS = "https://youtubeanalytics.googleapis.com/v2";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * FB/IG period=day insights stamp each value with an `end_time` that is the
 * START of the NEXT day; the value covers the day before. Subtract one day
 * and take the date so the metric lands on the day it actually describes.
 */
function dayFromEndTime(endTime: string): string {
  return ymd(subDays(parseISO(endTime), 1));
}

/** Inclusive list of local-midnight Dates from start..end, one per day. */
function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur <= last) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry points

export async function runSocialDailyPull(args: { clientId: string; days?: number }): Promise<EtlPullResult> {
  const supabase = createAdminClient();
  const end = new Date();
  // Sliding re-pull window — cron uses 7 days; a larger window can seed a
  // recently-added metric (e.g. IG reach, capped to ~30 days) in one shot.
  const start = subDays(end, args.days ?? 7);
  const { rows, statuses } = await collectRows(supabase, args.clientId, start, end, "cron");
  const rowsWritten = await upsertDailyRows(supabase, rows);
  // `statuses` carries each connected platform's outcome so the daily Slack
  // digest can flag a platform that errored or wrote zero rows — the aggregate
  // rowsWritten alone would hide a single silently-failing platform.
  return { rowsWritten, breakdown: statuses };
}

export async function runSocialBackfill(args: {
  clientId: string;
  /** Limit to one platform; omit to backfill every connected one. */
  platform?: SocialPlatform;
}): Promise<EtlPullResult> {
  const supabase = createAdminClient();
  const connected = await connectedPlatforms(supabase, args.clientId);
  const accounts = await activeAccountIds(supabase, args.clientId);
  const targets = args.platform ? [args.platform] : connected;
  let total = 0;

  for (const platform of targets) {
    if (!connected.includes(platform)) continue;
    const jobId = await startBackfillJob(supabase, args.clientId, platform, accounts.get(platform) ?? UNKNOWN_ACCOUNT);
    try {
      let written: number;
      let earliest: string | null;
      let latest: string | null;
      if (platform === "meta_instagram") {
        // Chunked + resumable (IG is ~2 years of 1-call-per-day insights).
        const r = await backfillIgChunked(supabase, args.clientId);
        written = r.written;
        earliest = r.earliest;
        latest = r.latest;
        if (!r.complete) {
          console.warn(`[social-backfill] IG backfill for ${args.clientId} hit the time budget; re-trigger to finish the remaining history.`);
        }
      } else {
        const rows = await backfillRowsFor(supabase, args.clientId, platform);
        written = await upsertDailyRows(supabase, rows);
        const days = rows.map((r) => r.day).sort();
        earliest = days[0] ?? null;
        latest = days[days.length - 1] ?? null;
      }
      total += written;
      await finishBackfillJob(supabase, jobId, {
        status: "done",
        rows_written: written,
        earliest_day: earliest,
        latest_day: latest,
      });
    } catch (e) {
      await finishBackfillJob(supabase, jobId, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { rowsWritten: total };
}

// ─────────────────────────────────────────────────────────────────────────────
// Row collection — fan out across connected platforms for [start, end]

async function collectRows(
  supabase: Supa, clientId: string, start: Date, end: Date,
  source: DailyRow["source"],
): Promise<{ rows: DailyRow[]; statuses: EtlBreakdownItem[] }> {
  const connected = await connectedPlatforms(supabase, clientId);
  const statuses: EtlBreakdownItem[] = [];

  // Per-platform runner. Still isolates failures (one platform throwing never
  // sinks the others) but, unlike the old blanket safe(), RECORDS each
  // platform's outcome so the daily Slack digest can tell apart healthy
  // (ok, rows>0), wrote-nothing (ok, rows=0 — suspicious for an active account,
  // often a fetcher that swallowed a bad HTTP response into []), and errored
  // (ok=false + message).
  const run = async (platform: SocialPlatform, fn: () => Promise<DailyRow[]>): Promise<DailyRow[]> => {
    try {
      const r = await fn();
      statuses.push({ key: platform, ok: true, rows: r.length });
      return r;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[social ETL] ${platform} fetch failed:`, error);
      statuses.push({ key: platform, ok: false, rows: 0, error });
      return [];
    }
  };

  const tasks: Array<Promise<DailyRow[]>> = [];
  if (connected.includes("youtube")) {
    tasks.push(run("youtube", () => youtubeDailyRows(supabase, clientId, start, end, source)));
  }
  // Meta: FB + IG share ONE creds load (and thus one token mint) but are
  // SEPARATE digest lines. Load once; a creds-load failure is attributed to
  // both connected Meta platforms, and each sub-fetch's own failure to just it.
  if (connected.includes("meta_facebook") || connected.includes("meta_instagram")) {
    tasks.push((async (): Promise<DailyRow[]> => {
      let creds: Awaited<ReturnType<typeof loadMetaCreds>> = null;
      let credsErr: string | null = null;
      try {
        creds = await loadMetaCreds(supabase, clientId);
      } catch (e) {
        credsErr = e instanceof Error ? e.message : String(e);
      }
      const out: DailyRow[] = [];
      if (connected.includes("meta_facebook")) {
        out.push(...await run("meta_facebook", async () => {
          if (credsErr) throw new Error(`meta creds load failed: ${credsErr}`);
          if (!creds?.fbPageId) return [];
          return fbDailyRows(clientId, creds.token, creds.fbPageId, start, end, source);
        }));
      }
      if (connected.includes("meta_instagram")) {
        out.push(...await run("meta_instagram", async () => {
          if (credsErr) throw new Error(`meta creds load failed: ${credsErr}`);
          if (!creds?.igUserId) return [];
          return igDailyRows(clientId, creds.token, creds.igUserId, start, end, source);
        }));
      }
      return out;
    })());
  }
  if (connected.includes("tiktok")) {
    tasks.push(run("tiktok", () => tiktokDailyRows(supabase, clientId, source)));
  }
  // LinkedIn: pending API approval — no fetcher yet.

  const rows: DailyRow[] = [];
  for (const r of await Promise.all(tasks)) rows.push(...r);
  return { rows, statuses };
}

/**
 * Which platform SERIES this client has. Note client_social_credentials uses
 * 'meta' for one row covering both FB + IG; we expand it into the two series
 * the daily table tracks (and only include IG if an ig_user_id is present).
 */
export async function connectedPlatforms(supabase: Supa, clientId: string): Promise<SocialPlatform[]> {
  const { data } = await supabase
    .from("client_social_credentials")
    .select("platform, ig_user_id")
    .eq("client_id", clientId);
  const out: SocialPlatform[] = [];
  for (const row of (data ?? []) as Array<{ platform: string; ig_user_id: string | null }>) {
    if (row.platform === "meta") {
      out.push("meta_facebook");
      if (row.ig_user_id) out.push("meta_instagram");
    } else if (row.platform === "youtube") out.push("youtube");
    else if (row.platform === "tiktok") out.push("tiktok");
    else if (row.platform === "linkedin") out.push("linkedin");
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube — daily Analytics (full history). Returns per-day views,
// engagements, follower deltas, and a back-computed absolute follower curve.

async function youtubeDailyRows(
  supabase: Supa, clientId: string, start: Date, end: Date, source: DailyRow["source"],
): Promise<DailyRow[]> {
  const cid = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!cid || !secret) return [];

  const { data: creds } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, youtube_channel_id")
    .eq("client_id", clientId).eq("platform", "youtube").maybeSingle();
  if (!creds) return [];
  const c = creds as { access_token_secret_id: string; youtube_channel_id: string | null };
  const accountId = c.youtube_channel_id ?? UNKNOWN_ACCOUNT;

  const refreshToken = await getVaultSecret(supabase, c.access_token_secret_id);
  const { access_token } = await refreshYoutubeToken({ clientId: cid, clientSecret: secret, refreshToken });

  // Current absolute subscriber count → anchor for back-computing the
  // per-day absolute curve. Walking deltas backward from "now" is accurate
  // because the window always ends at ~today (≤2-day reporting lag).
  let currentSubs = 0;
  const ch = await fetch(`${YT_DATA}/channels?mine=true&part=statistics`, {
    headers: { Authorization: `Bearer ${access_token}` }, cache: "no-store",
  });
  if (ch.ok) {
    const j = (await ch.json()) as { items?: Array<{ statistics?: { subscriberCount?: string } }> };
    currentSubs = Number(j.items?.[0]?.statistics?.subscriberCount ?? 0);
  }

  // YouTube Analytics has a ~2-day reporting lag — cap endDate accordingly.
  const endCapped = subDays(end, 2);
  if (endCapped < start) return [];
  const metrics = "views,likes,comments,shares,subscribersGained,subscribersLost,estimatedMinutesWatched";
  const url =
    `${YT_ANALYTICS}/reports?ids=channel==MINE&startDate=${ymd(start)}&endDate=${ymd(endCapped)}` +
    `&metrics=${metrics}&dimensions=day&sort=day`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` }, cache: "no-store" });
  if (!r.ok) return [];
  const body = (await r.json()) as { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<string | number>> };
  const headers = (body.columnHeaders ?? []).map((h) => h.name);
  const at = (row: Array<string | number>, name: string): number => {
    const i = headers.indexOf(name);
    return i >= 0 && typeof row[i] === "number" ? (row[i] as number) : 0;
  };
  const dayIdx = headers.indexOf("day");
  const recs = (body.rows ?? []).map((row) => ({
    day: String(row[dayIdx]),
    views: at(row, "views"),
    eng: at(row, "likes") + at(row, "comments") + at(row, "shares"),
    shares: at(row, "shares"), // also stored discretely for the Shares breakdown tile
    delta: at(row, "subscribersGained") - at(row, "subscribersLost"),
    gained: at(row, "subscribersGained"), // gross — for follows_gained
    watch: at(row, "estimatedMinutesWatched"),
  }));

  // Back-compute absolute followers: end-of-last-day ≈ currentSubs, then walk
  // backward subtracting each day's net change.
  const absByDay: Record<string, number> = {};
  let running = currentSubs;
  for (let i = recs.length - 1; i >= 0; i--) {
    absByDay[recs[i].day] = running;
    running -= recs[i].delta;
  }

  return recs.map((rec) => ({
    client_id: clientId,
    platform: "youtube" as const,
    account_id: accountId,
    day: rec.day,
    followers: absByDay[rec.day] ?? null,
    followers_delta: rec.delta,
    follows_gained: rec.gained,
    impressions: rec.views,
    engagements: rec.eng,
    profile_visits: null,
    link_clicks: null,
    reach: null,
    watch_time_minutes: rec.watch,
    shares: rec.shares,
    source,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta — Facebook Page + Instagram. Two independent series, split into
// separate fetchers so a FB-only backfill never triggers IG's day-loop.

type MetaCreds = { token: string; fbPageId: string | null; igUserId: string | null };

async function loadMetaCreds(supabase: Supa, clientId: string): Promise<MetaCreds | null> {
  const { data } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, fb_page_id, ig_user_id")
    .eq("client_id", clientId).eq("platform", "meta").maybeSingle();
  if (!data) return null;
  const c = data as { access_token_secret_id: string; fb_page_id: string | null; ig_user_id: string | null };
  const token = await getVaultSecret(supabase, c.access_token_secret_id);
  return { token, fbPageId: c.fb_page_id, igUserId: c.ig_user_id };
}

/** Facebook Page — native daily insights (one call covers the window). */
async function fbDailyRows(
  clientId: string, token: string, fbPageId: string, start: Date, end: Date, source: DailyRow["source"],
): Promise<DailyRow[]> {
  const since = Math.floor(start.getTime() / 1000);
  const until = Math.floor(end.getTime() / 1000);
  const today = ymd(end);
  const byDay = new Map<string, DailyRow>();

  const insights = await metaGet(
    `${G}/${fbPageId}/insights?metric=page_post_engagements,page_media_view,page_views_total,page_daily_follows_unique&period=day&since=${since}&until=${until}&access_token=${token}`,
  );
  for (const metric of insights) {
    for (const v of metric.values) {
      const day = dayFromEndTime(v.end_time);
      const row = byDay.get(day) ?? blankRow(clientId, "meta_facebook", fbPageId, day, source);
      if (metric.name === "page_post_engagements") row.engagements = v.value;
      else if (metric.name === "page_media_view") row.impressions = v.value;
      else if (metric.name === "page_views_total") row.profile_visits = v.value;
      else if (metric.name === "page_daily_follows_unique") row.follows_gained = v.value;
      byDay.set(day, row);
    }
  }
  const fb = await metaGetOne(`${G}/${fbPageId}?fields=followers_count,fan_count&access_token=${token}`);
  if (fb) {
    const followers = Number(fb.followers_count ?? fb.fan_count ?? 0) || null;
    const row = byDay.get(today) ?? blankRow(clientId, "meta_facebook", fbPageId, today, source);
    row.followers = followers;
    byDay.set(today, row);
  }
  return [...byDay.values()];
}

/**
 * Instagram — synthesize a daily series by querying total_value over a
 * 1-DAY window per day. IG has no native per-day array for views /
 * total_interactions / profile_views / website_clicks ("incompatible with
 * time_series"), but a single-day window returns just that day's value, so
 * iterating days builds the series. `views` is the impressions measure
 * (additive, matches the tiles). Bounded by IG's ~30-day retention.
 */
async function igDailyRows(
  clientId: string, token: string, igUserId: string, start: Date, end: Date, source: DailyRow["source"],
): Promise<DailyRow[]> {
  const days = eachDay(start, end);
  const rows: DailyRow[] = [];
  // One call per day (these metrics have no native daily array), so run them
  // in bounded-concurrency batches — sequential would be minutes for a deep
  // backfill. IG retains ~2 years; Graph handles ~10 concurrent reads fine.
  const CONCURRENCY = 10;
  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const batch = days.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (d) => {
      const since = Math.floor(d.getTime() / 1000);
      const until = since + 86_400;
      const totals = await metaGetTotals(
        `${G}/${igUserId}/insights?metric=views,total_interactions,profile_views,website_clicks&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${token}`,
      );
      return totals ? { d, totals } : null;
    }));
    for (const res of results) {
      if (!res) continue;
      rows.push({
        client_id: clientId, platform: "meta_instagram", account_id: igUserId, day: ymd(res.d),
        followers: null, followers_delta: null,
        impressions: res.totals["views"] ?? null,
        engagements: res.totals["total_interactions"] ?? null,
        profile_visits: res.totals["profile_views"] ?? null,
        link_clicks: res.totals["website_clicks"] ?? null,
        source,
      });
    }
  }
  // IG follows GAINED per day — `follower_count` is time_series-only and the
  // API caps it at ~30 days, so one call covers the recent window; older days
  // stay null and the nightly cron fills them forward. (Matches Business
  // Suite's "Follows".)
  const fcSince = Math.max(Math.floor(start.getTime() / 1000), Math.floor((Date.now() - 30 * 86_400_000) / 1000));
  const fcUntil = Math.floor(end.getTime() / 1000);
  if (fcUntil > fcSince) {
    const res = await fetch(
      `${G}/${igUserId}/insights?metric=follower_count&period=day&metric_type=time_series&since=${fcSince}&until=${fcUntil}&access_token=${token}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const body = (await res.json()) as { data?: Array<{ values?: Array<{ value?: number; end_time?: string }> }> };
      const gainedByDay = new Map<string, number>();
      for (const v of body.data?.[0]?.values ?? []) {
        if (typeof v.value === "number" && typeof v.end_time === "string") {
          gainedByDay.set(dayFromEndTime(v.end_time), v.value);
        }
      }
      for (const row of rows) {
        const g = gainedByDay.get(row.day);
        if (typeof g === "number") row.follows_gained = g;
      }
    }
  }

  // IG reach — native daily time_series (unique accounts reached). Like
  // follower_count the API only serves the last ~30 days, so the nightly cron
  // extends it forward; older days stay null. Distinct from `views`
  // (impressions), which counts repeats.
  const rSince = Math.max(Math.floor(start.getTime() / 1000), Math.floor((Date.now() - 30 * 86_400_000) / 1000));
  const rUntil = Math.floor(end.getTime() / 1000);
  if (rUntil > rSince) {
    const res = await fetch(
      `${G}/${igUserId}/insights?metric=reach&period=day&metric_type=time_series&since=${rSince}&until=${rUntil}&access_token=${token}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const body = (await res.json()) as { data?: Array<{ values?: Array<{ value?: number; end_time?: string }> }> };
      const reachByDay = new Map<string, number>();
      for (const v of body.data?.[0]?.values ?? []) {
        if (typeof v.value === "number" && typeof v.end_time === "string") reachByDay.set(dayFromEndTime(v.end_time), v.value);
      }
      for (const row of rows) { const rch = reachByDay.get(row.day); if (typeof rch === "number") row.reach = rch; }
    }
  }

  // Today's absolute follower snapshot (merged onto today's row if present).
  const ig = await metaGetOne(`${G}/${igUserId}?fields=followers_count&access_token=${token}`);
  if (ig) {
    const today = ymd(end);
    const followers = Number(ig.followers_count ?? 0) || null;
    const existing = rows.find((r) => r.day === today);
    if (existing) existing.followers = followers;
    else rows.push({
      client_id: clientId, platform: "meta_instagram", account_id: igUserId, day: today,
      followers, followers_delta: null,
      impressions: null, engagements: null, profile_visits: null, link_clicks: null, source,
    });
  }
  return rows;
}

/** GET a Meta insights edge → array of { name, values:[{value,end_time}] }. */
async function metaGet(url: string): Promise<Array<{ name: string; values: Array<{ value: number; end_time: string }> }>> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    data?: Array<{ name?: string; values?: Array<{ value?: unknown; end_time?: string }> }>;
  };
  return (body.data ?? []).map((d) => ({
    name: String(d.name ?? ""),
    values: (d.values ?? [])
      .filter((v) => typeof v.value === "number" && typeof v.end_time === "string")
      .map((v) => ({ value: v.value as number, end_time: v.end_time as string })),
  }));
}

/** GET a single Meta node → plain object (or null on error). */
async function metaGetOne(url: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/** GET a Meta total_value insights edge → { metricName: value }. Used for the
 *  per-day IG queries (metric_type=total_value over a 1-day window). */
async function metaGetTotals(url: string): Promise<Record<string, number> | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    data?: Array<{ name?: string; total_value?: { value?: number } }>;
  };
  const out: Record<string, number> = {};
  for (const d of body.data ?? []) {
    if (d.name && typeof d.total_value?.value === "number") out[d.name] = d.total_value.value;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// TikTok — snapshot only. No daily history, so we record TODAY's absolute
// follower count. (Per-day impressions/engagements aren't derivable from the
// Login Kit API — video stats are cumulative-to-date, not per-day.)

async function tiktokDailyRows(
  supabase: Supa, clientId: string, source: DailyRow["source"],
): Promise<DailyRow[]> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return [];

  const { data: creds } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, tiktok_open_id")
    .eq("client_id", clientId).eq("platform", "tiktok").maybeSingle();
  if (!creds) return [];
  const c = creds as { access_token_secret_id: string; tiktok_open_id: string | null };
  const accountId = c.tiktok_open_id ?? UNKNOWN_ACCOUNT;

  // Refresh rotates the refresh token — persist the new one back to Vault.
  const oldRefresh = await getVaultSecret(supabase, c.access_token_secret_id);
  const refreshed = await refreshTiktokToken({ clientKey, clientSecret, refreshToken: oldRefresh });
  await setVaultSecret(supabase, {
    existingId: c.access_token_secret_id,
    secretValue: refreshed.refresh_token,
    secretName: `tiktok_refresh_token__${clientId}__${c.tiktok_open_id ?? "unknown"}`,
  });

  const res = await fetch(`${TT_USER_INFO}`, {
    headers: { Authorization: `Bearer ${refreshed.access_token}` }, cache: "no-store",
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: { user?: { follower_count?: number } } };
  const followers = Number(body.data?.user?.follower_count ?? 0) || null;
  const today = ymd(new Date());

  // Net follows gained = today's absolute − the most recent prior snapshot.
  // TikTok's API exposes NO follower history, so a snapshot diff is the only
  // path (forward-only — needs ≥2 days of snapshots; can't be backfilled).
  // This is "net" (can be negative), matching TikTok Studio's "Net followers".
  let follows_gained: number | null = null;
  if (typeof followers === "number") {
    const { data: prior } = await supabase
      .from("social_daily_metrics")
      .select("followers")
      .eq("client_id", clientId).eq("platform", "tiktok").eq("account_id", accountId)
      .lt("day", today).not("followers", "is", null)
      .order("day", { ascending: false }).limit(1).maybeSingle();
    const priorFollowers = (prior as { followers: number } | null)?.followers;
    if (typeof priorFollowers === "number") follows_gained = followers - priorFollowers;
  }

  // Recent-video snapshot → client_tiktok_videos. TikTok has no per-day
  // metrics, so we store each recent video's CURRENT cumulative stats + post
  // time; the scorecard aggregates by create_time (videos posted in range,
  // avg views, engagement rate). We ALSO store cover/share_url/title so the
  // "Top content" posts pull can reshape these into social_posts without a
  // second TikTok token refresh (the refresh rotates the token — doing it twice
  // a night would be wasteful and race-prone). Best-effort: a failure here must
  // not lose the follower snapshot above.
  try {
    const vfields = "id,create_time,view_count,like_count,comment_count,share_count,cover_image_url,share_url,title";
    const videos: Array<TiktokVideo> = [];
    let cursor: number | undefined;
    for (let page = 0; page < 3; page++) {
      const vres = await fetch(`${TT_VIDEO_LIST}?fields=${vfields}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshed.access_token}`, "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }),
      });
      if (!vres.ok) break;
      const vbody = (await vres.json()) as {
        data?: { videos?: Array<Record<string, unknown>>; cursor?: number; has_more?: boolean };
      };
      for (const v of vbody.data?.videos ?? []) {
        videos.push({
          id: String(v.id ?? ""),
          create_time: Number(v.create_time ?? 0),
          view_count: Number(v.view_count ?? 0),
          like_count: Number(v.like_count ?? 0),
          comment_count: Number(v.comment_count ?? 0),
          share_count: Number(v.share_count ?? 0),
          cover_image_url: typeof v.cover_image_url === "string" ? v.cover_image_url : null,
          share_url: typeof v.share_url === "string" ? v.share_url : null,
          title: typeof v.title === "string" ? v.title : null,
        });
      }
      if (!vbody.data?.has_more || typeof vbody.data?.cursor !== "number") break;
      cursor = vbody.data.cursor;
    }
    if (videos.length > 0) {
      await supabase.from("client_tiktok_videos").upsert(
        { client_id: clientId, account_id: accountId, videos, fetched_at: new Date().toISOString() },
        { onConflict: "client_id" },
      );
    }
  } catch { /* video list is best-effort */ }

  return [{
    client_id: clientId,
    platform: "tiktok",
    account_id: accountId,
    day: today,
    followers,
    followers_delta: null,
    follows_gained,
    impressions: null,
    engagements: null,
    profile_visits: null,
    link_clicks: null,
    source,
  }];
}

const TT_USER_INFO = "https://open.tiktokapis.com/v2/user/info/?fields=follower_count";
const TT_VIDEO_LIST = "https://open.tiktokapis.com/v2/video/list/";

// ─────────────────────────────────────────────────────────────────────────────
// Backfill — deepest history each platform allows.

async function backfillRowsFor(
  supabase: Supa, clientId: string, platform: SocialPlatform,
): Promise<DailyRow[]> {
  const today = new Date();
  switch (platform) {
    case "youtube":
      // One Analytics call covers the whole range (dimensions=day). Cap at
      // 5 years; YouTube only returns days that have data.
      return youtubeDailyRows(supabase, clientId, subDays(today, 1825), today, "backfill");

    case "meta_facebook": {
      const creds = await loadMetaCreds(supabase, clientId);
      if (!creds?.fbPageId) return [];
      // FB insights window is capped per call (~90 days) → chunk back ~2y.
      const out: DailyRow[] = [];
      let chunkEnd = today;
      const oldest = subDays(today, 730);
      while (chunkEnd > oldest) {
        const chunkStart = subDays(chunkEnd, 90) < oldest ? oldest : subDays(chunkEnd, 90);
        out.push(...(await fbDailyRows(clientId, creds.token, creds.fbPageId, chunkStart, chunkEnd, "backfill")));
        chunkEnd = subDays(chunkStart, 1);
      }
      return out;
    }

    case "meta_instagram":
      // IG goes through backfillIgChunked (chunked + resumable) in
      // runSocialBackfill — never through here. This guard is the safety net:
      // if IG ever reaches this switch it throws loudly rather than silently
      // running an unchunked 730-day pull (which would risk a 300s timeout).
      // Keeping the case also keeps the switch exhaustive over SocialPlatform.
      throw new Error("meta_instagram backfill must use backfillIgChunked");

    case "tiktok":
      // No history — just seed today's snapshot.
      return tiktokDailyRows(supabase, clientId, "backfill");

    case "linkedin":
      return []; // pending API approval
  }
}

/** Earliest stored day for one platform — the resume cursor for a chunked
 *  backfill (null if we have nothing yet). */
async function earliestStoredDay(
  supabase: Supa, clientId: string, platform: SocialPlatform, accountId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("social_daily_metrics")
    .select("day")
    .eq("client_id", clientId)
    .eq("platform", platform)
    .eq("account_id", accountId)
    .order("day", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { day: string } | null)?.day ?? null;
}

/**
 * Instagram backfill — chunked, incrementally upserted, resumable.
 *
 * IG insights cost 1 API call PER DAY and Meta throttles them, so ~2 years
 * takes minutes — too long for a single function on some setups, and a plain
 * collect-then-upsert loses everything to a timeout. Instead we:
 *   - walk BACKWARD in `chunkDays` windows, upserting EACH chunk immediately
 *     (a timeout keeps every completed chunk);
 *   - RESUME from the earliest day already stored, so a re-trigger continues
 *     the remaining history instead of redoing it;
 *   - stop before a soft time budget and report `complete:false` so the run
 *     can be finished by a re-trigger / the next cron.
 * Upserts are idempotent on (client_id, platform, day), so overlap is safe.
 *
 * `igDailyRows` also appends a "today" snapshot row (current absolute
 * followers); for an OLD chunk that row would clobber today's real cron data
 * on upsert, so each chunk is filtered to its own [start, end] window.
 */
async function backfillIgChunked(
  supabase: Supa, clientId: string,
  opts: { chunkDays?: number; softBudgetMs?: number; totalDays?: number } = {},
): Promise<{ written: number; complete: boolean; earliest: string | null; latest: string | null }> {
  const creds = await loadMetaCreds(supabase, clientId);
  if (!creds?.igUserId) return { written: 0, complete: true, earliest: null, latest: null };

  const chunkDays = opts.chunkDays ?? 60;
  const softBudgetMs = opts.softBudgetMs ?? 240_000; // ~4 min, well under a 300s ceiling
  const totalDays = opts.totalDays ?? 730;

  const today = new Date();
  const target = subDays(today, totalDays);
  const targetStr = ymd(target);
  const latest = ymd(today);

  // Resume: if we already reach the target depth, there's nothing to do. Scope
  // to the ACTIVE IG account so a just-switched account backfills fresh instead
  // of resuming from the previous account's (deeper) earliest day.
  const existingMin = await earliestStoredDay(supabase, clientId, "meta_instagram", creds.igUserId);
  if (existingMin && existingMin <= targetStr) {
    return { written: 0, complete: true, earliest: existingMin, latest };
  }

  let chunkEnd: Date = existingMin ? subDays(parseISO(existingMin), 1) : today;
  let written = 0;
  let earliest = existingMin;
  const startedAt = Date.now();

  while (ymd(chunkEnd) >= targetStr) {
    const tentativeStart = subDays(chunkEnd, chunkDays - 1);
    const chunkStart = ymd(tentativeStart) < targetStr ? target : tentativeStart;
    const csStr = ymd(chunkStart);
    const ceStr = ymd(chunkEnd);

    const rows = (await igDailyRows(clientId, creds.token, creds.igUserId, chunkStart, chunkEnd, "backfill"))
      .filter((r) => r.day >= csStr && r.day <= ceStr); // drop the appended "today" row on old chunks
    written += await upsertDailyRows(supabase, rows);
    earliest = csStr;

    if (csStr <= targetStr) break; // reached the oldest day we want
    chunkEnd = subDays(chunkStart, 1);
    if (Date.now() - startedAt > softBudgetMs) {
      return { written, complete: false, earliest, latest };
    }
  }
  return { written, complete: true, earliest, latest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence

function blankRow(
  clientId: string, platform: SocialPlatform, accountId: string, day: string, source: DailyRow["source"],
): DailyRow {
  return {
    client_id: clientId, platform, account_id: accountId, day,
    followers: null, followers_delta: null, follows_gained: null,
    impressions: null, engagements: null, profile_visits: null, link_clicks: null,
    reach: null, watch_time_minutes: null, shares: null,
    source,
  };
}

/** Upsert rows on (client_id, platform, day). Normalizes every row to a
 *  uniform column set so the batch insert is well-formed. */
async function upsertDailyRows(supabase: Supa, rows: DailyRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const normalized = rows.map((r) => ({
    client_id: r.client_id,
    platform: r.platform,
    account_id: r.account_id,
    day: r.day,
    followers: r.followers ?? null,
    followers_delta: r.followers_delta ?? null,
    follows_gained: r.follows_gained ?? null,
    impressions: r.impressions ?? null,
    engagements: r.engagements ?? null,
    profile_visits: r.profile_visits ?? null,
    link_clicks: r.link_clicks ?? null,
    reach: r.reach ?? null,
    watch_time_minutes: r.watch_time_minutes ?? null,
    shares: r.shares ?? null,
    source: r.source,
    fetched_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("social_daily_metrics")
    .upsert(normalized, { onConflict: "client_id,platform,account_id,day" });
  if (error) throw new Error(`social_daily_metrics upsert failed: ${error.message}`);
  return normalized.length;
}

async function startBackfillJob(
  supabase: Supa, clientId: string, platform: SocialPlatform, accountId: string,
): Promise<string> {
  const { data } = await supabase
    .from("social_backfill_jobs")
    .insert({ client_id: clientId, platform, account_id: accountId, status: "running" })
    .select("id").single();
  return (data?.id as string | undefined) ?? "";
}

async function finishBackfillJob(
  supabase: Supa, jobId: string,
  patch: { status: string; rows_written?: number; earliest_day?: string | null; latest_day?: string | null; error?: string },
): Promise<void> {
  if (!jobId) return;
  await supabase
    .from("social_backfill_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}
