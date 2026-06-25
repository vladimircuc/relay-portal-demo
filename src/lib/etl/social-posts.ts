/**
 * Social POSTS ETL — writes individual posts into `social_posts` (migration
 * 026), the backing store for the /socials "Top performing content" cards.
 *
 * One entry point — `runSocialPostsPull({clientId})` — fans out across the
 * client's connected platforms, grabs their most-recent N posts (with the
 * headline reach + engagement breakdown), and upserts on
 * (client_id, platform, post_id). Re-pulling nightly CORRECTS a recent post's
 * still-settling counts and inserts newly-published posts, so the table fills
 * forward from the connect date.
 *
 * Per-platform sourcing:
 *   YouTube  — uploads playlist → videos.list (views/likes/comments).
 *   Facebook — /posts + a per-post post_media_view insights call for reach
 *              (+ reactions via insights, so likes survive without
 *              pages_read_engagement).
 *   Instagram— /media + a per-media views/reach/total_interactions/shares
 *              insights call. `views` (IG's unified repeat-inclusive metric, what
 *              the IG app + Plannable surface) is the headline number for EVERY
 *              media type; `reach` is the pre-2024 fallback for old media.
 *   TikTok   — reshaped from client_tiktok_videos (written by the daily pull),
 *              so we DON'T refresh the TikTok token a second time per night.
 *   LinkedIn — pending API approval (skipped).
 *
 * Like the daily pull, each platform fetch is wrapped so one platform's failure
 * never sinks the others, and the per-post reach calls are best-effort: a null
 * reach just means the post ranks on engagements instead.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "@/lib/etl/vault";
import { refreshAccessToken as refreshYoutubeToken } from "@/lib/youtube-oauth";
import { META_API_VERSION } from "@/lib/meta-oauth";
import { connectedPlatforms, type SocialPlatform, type TiktokVideo } from "@/lib/etl/social";
import { UNKNOWN_ACCOUNT } from "@/lib/etl/social-accounts";
import type { EtlPullResult } from "@/lib/etl/runs";

type Supa = ReturnType<typeof createAdminClient>;

type ReachKind = "impressions" | "plays" | "views" | "reach";
type MediaType = "image" | "video" | "reel" | "carousel" | "text";

/** One upsertable row, matching the social_posts columns. */
type PostRow = {
  client_id: string;
  platform: SocialPlatform;
  /** Stable platform account id this post belongs to (migration 028). Reads
   *  scope to the currently-connected account so a switched account's posts
   *  stay retained but hidden. */
  account_id: string;
  post_id: string;
  posted_at: string; // ISO timestamp
  permalink: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  media_type: MediaType | null;
  reach_kind: ReachKind | null;
  reach: number | null;
  engagements: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** Saves (Instagram only — the `saved` media insight; migration 030). Null on
   *  every other platform, whose APIs expose no equivalent. */
  saves: number | null;
  source: "backfill" | "cron" | "manual";
};

const G = `https://graph.facebook.com/${META_API_VERSION}`;
const YT_DATA = "https://www.googleapis.com/youtube/v3";

// ─────────────────────────────────────────────────────────────────────────────
// Entry point

export async function runSocialPostsPull(args: {
  clientId: string;
  /** Most-recent posts to pull per platform. Cron uses a small window;
   *  on-connect backfill passes a larger one to seed history in one shot. */
  limit?: number;
  source?: PostRow["source"];
  /** Restrict to these platforms (e.g. a single-platform backfill so we don't
   *  redundantly re-pull every other platform). Omit to pull all connected. */
  platforms?: SocialPlatform[];
}): Promise<EtlPullResult> {
  const supabase = createAdminClient();
  const limit = args.limit ?? 20;
  const source = args.source ?? "cron";
  const all = await connectedPlatforms(supabase, args.clientId);
  const connected = args.platforms ? all.filter((p) => args.platforms!.includes(p)) : all;

  const tasks: Array<Promise<PostRow[]>> = [];
  if (connected.includes("youtube")) {
    tasks.push(safe(() => youtubePostRows(supabase, args.clientId, limit, source)));
  }
  if (connected.includes("meta_facebook") || connected.includes("meta_instagram")) {
    tasks.push(safe(async () => {
      const creds = await loadMetaCreds(supabase, args.clientId);
      if (!creds) return [];
      const out: PostRow[] = [];
      if (connected.includes("meta_facebook") && creds.fbPageId) {
        out.push(...(await fbPostRows(args.clientId, creds.token, creds.fbPageId, limit, source)));
      }
      if (connected.includes("meta_instagram") && creds.igUserId) {
        out.push(...(await igPostRows(args.clientId, creds.token, creds.igUserId, limit, source)));
      }
      return out;
    }));
  }
  if (connected.includes("tiktok")) {
    tasks.push(safe(() => tiktokPostRows(supabase, args.clientId, source)));
  }
  // LinkedIn: pending API approval — no fetcher yet.

  const rows: PostRow[] = [];
  for (const r of await Promise.all(tasks)) rows.push(...r);
  const rowsWritten = await upsertPostRows(supabase, rows);
  return { rowsWritten };
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube — most-recent uploads + per-video stats.

type YtListBody = {
  items?: Array<{
    id?: string;
    contentDetails?: { videoId?: string; duration?: string; relatedPlaylists?: { uploads?: string } };
    snippet?: {
      title?: string;
      publishedAt?: string;
      thumbnails?: { medium?: { url?: string }; high?: { url?: string }; maxres?: { url?: string } };
    };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }>;
};

async function youtubePostRows(
  supabase: Supa, clientId: string, limit: number, source: PostRow["source"],
): Promise<PostRow[]> {
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

  // Uploads playlist → recent video IDs → one videos.list for full stats.
  const ch = await ytGet<YtListBody>(`${YT_DATA}/channels?mine=true&part=contentDetails`, access_token);
  const uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];

  const pl = await ytGet<YtListBody>(
    `${YT_DATA}/playlistItems?playlistId=${uploads}&part=contentDetails&maxResults=${limit}`, access_token,
  );
  const ids = (pl?.items ?? [])
    .map((i) => i.contentDetails?.videoId)
    .filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return [];

  const vids = await ytGet<YtListBody>(
    `${YT_DATA}/videos?id=${ids.join(",")}&part=snippet,statistics,contentDetails`, access_token,
  );
  return (vids?.items ?? []).flatMap((v) => {
    const id = String(v.id ?? "");
    if (!id) return [];
    const dur = parseIsoDuration(v.contentDetails?.duration ?? "PT0S");
    const isShort = dur > 0 && dur <= 60;
    // Prefer `high` (hqdefault) — it's generated for EVERY live video. `maxres`
    // (maxresdefault) is sharper but 404s for many Shorts / SD uploads, which
    // rendered as broken thumbnails, so it's only the last resort.
    const thumb =
      v.snippet?.thumbnails?.high?.url ??
      v.snippet?.thumbnails?.medium?.url ??
      v.snippet?.thumbnails?.maxres?.url ?? null;
    const likes = num(v.statistics?.likeCount);
    const comments = num(v.statistics?.commentCount);
    return [{
      client_id: clientId, platform: "youtube", account_id: accountId, post_id: id,
      posted_at: v.snippet?.publishedAt || new Date().toISOString(),
      permalink: isShort ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
      thumbnail_url: thumb,
      caption: v.snippet?.title ?? "",
      media_type: (isShort ? "reel" : "video") as MediaType,
      reach_kind: "views" as ReachKind,
      reach: num(v.statistics?.viewCount),
      engagements: likes + comments,
      likes, comments, shares: null, saves: null,
      source,
    }];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta — Facebook Page posts + Instagram media. One long-lived token (no
// refresh dance), so a second pass here is safe (unlike TikTok).

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

type FbPost = {
  id?: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  attachments?: { data?: Array<{ media_type?: string }> };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
};

async function fbPostRows(
  clientId: string, token: string, pageId: string, limit: number, source: PostRow["source"],
): Promise<PostRow[]> {
  // Public-readable on any Page token. `shares` is a plain count, not a
  // summary edge, so it isn't gated like reactions/comments.
  const BASE = ["id", "message", "created_time", "permalink_url", "full_picture", "attachments{media_type}", "shares"];
  // reactions/comments need `pages_read_engagement`. Graph rejects the WHOLE
  // request if ANY requested field is ungranted — so we try with them, and on
  // failure retry with just BASE so posts still seed (likes/comments null).
  const ENGAGEMENT = ["reactions.summary(total_count).limit(0)", "comments.summary(total_count).limit(0)"];
  // The /posts edge hard-caps page size at 100 — asking for more makes Graph
  // reject the whole request (no data), so a big shared limit would silently
  // zero out FB. Clamp to 100 (IG's /media edge accepts more, so the cap lives
  // here, not in the caller).
  const pageLimit = Math.min(limit, 100);
  const fetchPosts = (fields: string[]) =>
    mGet<{ data?: FbPost[] }>(`${G}/${pageId}/posts?fields=${fields.join(",")}&limit=${pageLimit}&access_token=${token}`);

  let hasEngagement = true;
  let body = await fetchPosts([...BASE, ...ENGAGEMENT]);
  if (!body?.data) {
    hasEngagement = false;
    body = await fetchPosts(BASE);
  }
  const posts = body?.data ?? [];

  // Bounded concurrency so a page of posts doesn't fan out into one burst.
  return mapLimit(posts, 6, async (p) => {
    const id = String(p.id ?? "");
    // Edge reactions/comments need pages_read_engagement; null (not 0) when
    // ungranted so the UI can tell "no data" from "zero".
    const edgeReactions = hasEngagement ? num(p.reactions?.summary?.total_count) : null;
    const comments = hasEngagement ? num(p.comments?.summary?.total_count) : null;
    const shares = num(p.shares?.count);
    // One insights call covers reach (post_media_view — the "Views" metric that
    // replaced the deprecated post_impressions, removed by Meta Nov 2025) AND
    // reactions. Reactions via insights need only read_insights, so FB likes
    // survive even when the /posts edge is gated.
    const ins = id ? await fbPostInsights(token, id) : { views: null, reactions: null };
    const reactions = edgeReactions ?? ins.reactions;
    return {
      client_id: clientId, platform: "meta_facebook", account_id: pageId, post_id: id,
      posted_at: p.created_time || new Date().toISOString(),
      permalink: p.permalink_url ?? null,
      thumbnail_url: p.full_picture ?? null,
      caption: p.message ?? "",
      media_type: fbMediaType(p.attachments?.data?.[0]?.media_type ?? null, p.full_picture ?? null),
      reach_kind: "views" as ReachKind,
      reach: ins.views,
      // Comments stay null until pages_read_engagement lands; reactions + shares
      // are measurable now. Saves: FB Page posts expose no saves metric → null.
      engagements: (reactions ?? 0) + (comments ?? 0) + shares,
      likes: reactions, comments, shares, saves: null,
      source,
    };
  });
}

/** Per-post reach + reactions in one insights call. `post_media_view` is the
 *  current "Views" metric (replaced the deprecated `post_impressions`);
 *  `post_reactions_by_type_total` returns a per-type map readable with
 *  `read_insights` alone. Best-effort: null on any miss.
 *
 *  Verified safe past Meta's June 15, 2026 Page Insights deprecation (checked
 *  Jun 2026): that wave removes only the Reach/Impressions family — the
 *  `post_impressions*` metrics and the `*_unique` reach/video-view variants.
 *  `post_media_view` is itself Meta's named replacement for `post_impressions`,
 *  and `post_reactions_by_type_total` is an engagement metric, explicitly out
 *  of scope (reactions/likes are not being deprecated). So neither name this
 *  call depends on is on the removal list — no migration needed. */
async function fbPostInsights(
  token: string, postId: string,
): Promise<{ views: number | null; reactions: number | null }> {
  const body = await mGet<{ data?: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> }>(
    `${G}/${postId}/insights?metric=post_media_view,post_reactions_by_type_total&access_token=${token}`,
  );
  const val = (name: string): unknown => {
    const e = body?.data?.find((d) => d.name === name);
    return e?.total_value?.value ?? e?.values?.[0]?.value;
  };
  const viewsRaw = val("post_media_view");
  const reactRaw = val("post_reactions_by_type_total");
  const reactions =
    reactRaw && typeof reactRaw === "object"
      ? Object.values(reactRaw as Record<string, unknown>).reduce<number>((a, b) => a + num(b), 0)
      : null;
  return { views: typeof viewsRaw === "number" ? viewsRaw : null, reactions };
}

function fbMediaType(attachmentType: string | null, picture: string | null): MediaType {
  switch (attachmentType) {
    case "photo": return "image";
    case "video":
    case "video_inline":
    case "video_autoplay":
    case "animated_image_video": return "video";
    case "album": return "carousel";
    default: return picture ? "image" : "text";
  }
}

type IgMedia = {
  id?: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

async function igPostRows(
  clientId: string, token: string, igUserId: string, limit: number, source: PostRow["source"],
): Promise<PostRow[]> {
  const fields = [
    "id", "caption", "media_type", "media_product_type",
    "media_url", "thumbnail_url", "permalink", "timestamp",
    "like_count", "comments_count",
  ].join(",");
  const body = await mGet<{ data?: IgMedia[] }>(`${G}/${igUserId}/media?fields=${fields}&limit=${limit}&access_token=${token}`);
  const media = body?.data ?? [];

  return mapLimit(media, 6, async (m) => {
    const id = String(m.id ?? "");
    const likes = num(m.like_count);
    const comments = num(m.comments_count);
    const ins = id ? await igMediaInsights(token, id) : { reach: null, views: null, totalInteractions: null, shares: null, saved: null };
    // Headline metric = IG's unified `views` (repeat-inclusive, what the IG app
    // and Plannable show) for EVERY media type — feed photos, carousels, reels
    // alike. Fall back to `reach` (unique accounts) only for old media that
    // predates the metric, and label it "reach" — NOT "impressions" (which IG
    // fully deprecated April 2025) — so the card's label matches the number.
    const hasViews = ins.views != null;
    return {
      client_id: clientId, platform: "meta_instagram", account_id: igUserId, post_id: id,
      posted_at: m.timestamp || new Date().toISOString(),
      permalink: m.permalink ?? null,
      thumbnail_url: m.thumbnail_url || m.media_url || null,
      caption: m.caption ?? "",
      media_type: igMediaType(m.media_type ?? null, m.media_product_type ?? null),
      reach_kind: (hasViews ? "views" : "reach") as ReachKind,
      reach: ins.views ?? ins.reach,
      engagements: ins.totalInteractions ?? likes + comments,
      likes, comments, shares: ins.shares, saves: ins.saved,
      source,
    };
  });
}

/** Per-media views + reach + total interactions (+ shares). Each is best-effort:
 *  the metric set IG serves varies by media type/age, so a miss just leaves that
 *  field null.
 *
 *  `views` is IG's unified play/impression count — repeat-inclusive (every view,
 *  not unique accounts), available for feed photos, carousels, AND reels since
 *  the 2024 media-insights consolidation. It's the number the IG app surfaces
 *  and the one Plannable reports, so it's our headline metric for all IG media.
 *  `reach` (unique accounts) stays as a fallback for pre-consolidation media that
 *  doesn't serve `views`. */
async function igMediaInsights(
  token: string, mediaId: string,
): Promise<{ reach: number | null; views: number | null; totalInteractions: number | null; shares: number | null; saved: number | null }> {
  const core = ["reach", "total_interactions"];
  const get = (metrics: string[]) =>
    mGet<{ data?: Array<{ name?: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }> }>(
      `${G}/${mediaId}/insights?metric=${metrics.join(",")}&access_token=${token}`,
    );
  // Graph rejects the WHOLE request if ANY requested metric is invalid for this
  // media, so descend a ladder: prefer views+shares+saved, then views, then bare
  // core. The last rung guarantees reach/interactions still land even when
  // `views` isn't served (very old media) — otherwise an unsupported `views`
  // would blank every field. `saved` (folded into total_interactions but pulled
  // discretely here for the Saves breakdown tile) and `shares` ride the rich
  // rung; on its failure they fall to null, like any best-effort metric.
  let body = await get([...core, "views", "shares", "saved"]);
  if (!body?.data) body = await get([...core, "views"]);
  if (!body?.data) body = await get(core);
  const pick = (name: string): number | null => {
    const entry = body?.data?.find((d) => d.name === name);
    const v = entry?.total_value?.value ?? entry?.values?.[0]?.value;
    return typeof v === "number" ? v : null;
  };
  return { reach: pick("reach"), views: pick("views"), totalInteractions: pick("total_interactions"), shares: pick("shares"), saved: pick("saved") };
}

function igMediaType(mediaType: string | null, productType: string | null): MediaType {
  if (productType === "REELS") return "reel";
  switch (mediaType) {
    case "CAROUSEL_ALBUM": return "carousel";
    case "VIDEO": return "video";
    case "IMAGE": return "image";
    default: return "image";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TikTok — reshaped from the snapshot the daily pull already wrote
// (client_tiktok_videos). No second API call / token refresh.

async function tiktokPostRows(
  supabase: Supa, clientId: string, source: PostRow["source"],
): Promise<PostRow[]> {
  const { data } = await supabase
    .from("client_tiktok_videos").select("videos, account_id").eq("client_id", clientId).maybeSingle();
  const snapshot = data as { videos?: TiktokVideo[]; account_id?: string | null } | null;
  // Attribute reshaped videos to the account that PRODUCED the snapshot, not
  // the currently-active one — so a stale snapshot (account just switched, cron
  // hasn't re-pulled) lands under the old account and stays correctly dormant
  // until the fresh pull overwrites it.
  const accountId = snapshot?.account_id ?? UNKNOWN_ACCOUNT;
  const vids = (snapshot?.videos ?? []).filter((v) => v.id);
  return vids.map((v) => {
    const likes = num(v.like_count);
    const comments = num(v.comment_count);
    const shares = num(v.share_count);
    return {
      client_id: clientId, platform: "tiktok", account_id: accountId, post_id: v.id,
      posted_at: new Date((v.create_time || 0) * 1000).toISOString(),
      permalink: v.share_url,
      thumbnail_url: v.cover_image_url,
      caption: v.title ?? "",
      media_type: "reel" as MediaType,
      reach_kind: "views" as ReachKind,
      reach: num(v.view_count),
      engagements: likes + comments + shares,
      // TikTok's Display API exposes no saves/favorites count → null.
      likes, comments, shares, saves: null,
      source,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence

async function upsertPostRows(supabase: Supa, rows: PostRow[]): Promise<number> {
  const valid = rows.filter((r) => r.post_id);
  if (valid.length === 0) return 0;
  const normalized = valid.map((r) => ({ ...r, fetched_at: new Date().toISOString() }));
  const { error } = await supabase
    .from("social_posts")
    .upsert(normalized, { onConflict: "client_id,platform,post_id" });
  if (error) throw new Error(`social_posts upsert failed: ${error.message}`);
  return normalized.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

/** Run a platform fetcher, swallowing errors into [] so one platform's failure
 *  never sinks the whole pull. */
async function safe(fn: () => Promise<PostRow[]>): Promise<PostRow[]> {
  try {
    return await fn();
  } catch (e) {
    console.error("[social-posts ETL] platform fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

const num = (x: unknown): number => Number(x ?? 0) || 0;

/** Map with bounded concurrency — keeps per-post insights fan-out civil. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Authenticated Google GET → parsed JSON (or null on non-200). */
async function ytGet<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Meta GET → parsed JSON (or null). Meta sometimes returns { error } at HTTP
 *  200; callers read `.data`, which is simply absent on an error body. */
async function mGet<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** ISO 8601 duration ("PT1M2S" → 62). Bounded to H/M/S (videos aren't days). */
function parseIsoDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, h, mm, s] = m;
  return Number(h ?? 0) * 3600 + Number(mm ?? 0) * 60 + Number(s ?? 0);
}
