/**
 * Server-side YouTube data fetcher for the admin "Account snapshot"
 * panel. Mirror of `lib/tiktok-data.ts` + `lib/meta-data.ts`.
 *
 * Single entry point — `fetchYoutubeSnapshot()` — that, given a
 * client_id:
 *   1. Loads the stored refresh_token from Vault
 *   2. Mints a fresh access_token via Google's OAuth refresh endpoint
 *      (~100ms; tokens last 1hr, no caching needed at our layer)
 *   3. Fans out 4 parallel reads:
 *      - channels.list (mine=true) → channel basics    [youtube.readonly]
 *      - playlistItems.list (uploads) → recent 6 vids  [youtube.readonly]
 *      - videos.list → per-video stats for those 6     [youtube.readonly]
 *      - analytics.reports.query (last 28d)            [yt-analytics.readonly]
 *   4. Returns a typed payload the React component renders directly
 *
 * Why this lives separately from the existing ETL — same reason as
 * TikTok/Meta snapshot panels: this is a real-time live view for the
 * admin page + OAuth-review demo. When the proper YouTube ETL ships,
 * this fetcher can be replaced with reads from cached tables.
 *
 * Failure mode: returns `{ ok: false, error: "..." }`. Callers are
 * server components and render the error inline.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "@/lib/etl/vault";
import { refreshAccessToken } from "@/lib/youtube-oauth";

const YT_DATA = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS = "https://youtubeanalytics.googleapis.com/v2";

export type YoutubeSnapshot = {
  ok: true;
  channel: {
    id: string;
    title: string;
    handle: string | null;
    description: string;
    thumbnail_url: string | null;
    /** Lifetime stats from channels.list (these are RAW counts — see note below). */
    view_count: number;
    subscriber_count: number;
    video_count: number;
    /** YouTube Analytics 28-day rollups. May be null if the channel is too
     *  new to have aggregated data yet. */
    views_28d: number | null;
    minutes_watched_28d: number | null;
    avg_view_duration_sec_28d: number | null;
    subs_gained_28d: number | null;
    subs_lost_28d: number | null;
    likes_28d: number | null;
    comments_28d: number | null;
    shares_28d: number | null;
  };
  videos: Array<{
    id: string;
    title: string;
    description: string;
    published_at: string;       // ISO timestamp
    duration_seconds: number;
    thumbnail_url: string | null;
    permalink: string;
    is_short: boolean;
    view_count: number;
    like_count: number;
    comment_count: number;
  }>;
};

export type YoutubeSnapshotResult = YoutubeSnapshot | { ok: false; error: string };

export async function fetchYoutubeSnapshot(args: {
  clientId: string;
}): Promise<YoutubeSnapshotResult> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: "Google OAuth client/secret not configured." };
  }

  try {
    const supabase = createAdminClient();

    const { data: creds } = await supabase
      .from("client_social_credentials")
      .select(
        "access_token_secret_id, youtube_channel_id, youtube_channel_title, youtube_channel_handle, youtube_channel_thumbnail",
      )
      .eq("client_id", args.clientId)
      .eq("platform", "youtube")
      .maybeSingle();

    if (!creds) return { ok: false, error: "No YouTube credential row for this client." };
    const c = creds as {
      access_token_secret_id: string;
      youtube_channel_id: string;
      youtube_channel_title: string | null;
      youtube_channel_handle: string | null;
      youtube_channel_thumbnail: string | null;
    };

    // 1. Mint a fresh short-lived access token from the stored refresh
    //    token. Google access tokens are 1-hour; we mint per request
    //    (cheap, ~100ms) since the admin page hits this rarely.
    const refreshToken = await getVaultSecret(supabase, c.access_token_secret_id);
    const { access_token } = await refreshAccessToken({
      clientId, clientSecret, refreshToken,
    });

    // 2. First read: channels.list to get the channel basics + uploads
    //    playlist ID. We need the uploads playlist ID before we can
    //    fetch recent videos, so this one is sequential.
    const channel = await fetchChannelBasics(access_token);
    if (!channel.ok) return { ok: false, error: channel.error };

    // 3. Fan out the rest in parallel.
    const [videos, analytics] = await Promise.all([
      fetchRecentVideos(access_token, channel.value.uploads_playlist_id, 6),
      fetchChannelAnalytics28d(access_token),
    ]);

    return {
      ok: true,
      channel: {
        id: channel.value.id,
        title: channel.value.title,
        handle: c.youtube_channel_handle ?? channel.value.handle,
        description: channel.value.description,
        thumbnail_url: c.youtube_channel_thumbnail ?? channel.value.thumbnail_url,
        view_count: channel.value.view_count,
        subscriber_count: channel.value.subscriber_count,
        video_count: channel.value.video_count,
        views_28d: analytics?.views ?? null,
        minutes_watched_28d: analytics?.estimatedMinutesWatched ?? null,
        avg_view_duration_sec_28d: analytics?.averageViewDuration ?? null,
        subs_gained_28d: analytics?.subscribersGained ?? null,
        subs_lost_28d: analytics?.subscribersLost ?? null,
        likes_28d: analytics?.likes ?? null,
        comments_28d: analytics?.comments ?? null,
        shares_28d: analytics?.shares ?? null,
      },
      videos: videos,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "YouTube snapshot failed." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper. Google APIs return non-200 with JSON error bodies.

async function get(url: string, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel basics + uploads playlist lookup

type ChannelBasics = {
  id: string;
  title: string;
  handle: string | null;
  description: string;
  thumbnail_url: string | null;
  view_count: number;
  subscriber_count: number;
  video_count: number;
  uploads_playlist_id: string | null;
};

async function fetchChannelBasics(
  token: string,
): Promise<{ ok: true; value: ChannelBasics } | { ok: false; error: string }> {
  const r = await get(
    `${YT_DATA}/channels?mine=true&part=snippet,statistics,contentDetails`,
    token,
  );
  if (r.status !== 200) {
    return { ok: false, error: `channels.list ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}` };
  }
  const items = (r.body as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        description?: string;
        thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
      };
      statistics?: { viewCount?: string; subscriberCount?: string; videoCount?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  })?.items ?? [];
  const item = items[0];
  if (!item || !item.id) return { ok: false, error: "channels.list returned no item." };
  return {
    ok: true,
    value: {
      id: item.id,
      title: item.snippet?.title ?? "",
      // customUrl is "@handle" sometimes, "handle" other times — strip
      // any leading @ so we control formatting in the UI.
      handle: item.snippet?.customUrl
        ? item.snippet.customUrl.replace(/^@/, "")
        : null,
      description: item.snippet?.description ?? "",
      thumbnail_url:
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        null,
      view_count: Number(item.statistics?.viewCount ?? 0),
      subscriber_count: Number(item.statistics?.subscriberCount ?? 0),
      video_count: Number(item.statistics?.videoCount ?? 0),
      uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent videos — uses the uploads playlist (1 quota unit) instead of
// search.list (100 units). For each video id we then fetch full stats
// in a single videos.list call.

async function fetchRecentVideos(
  token: string, uploadsPlaylistId: string | null, limit: number,
): Promise<YoutubeSnapshot["videos"]> {
  if (!uploadsPlaylistId) return [];

  // First: list the most recent N video IDs from the uploads playlist.
  const playlist = await get(
    `${YT_DATA}/playlistItems?playlistId=${uploadsPlaylistId}&part=contentDetails,snippet&maxResults=${limit}`,
    token,
  );
  if (playlist.status !== 200) return [];
  const playlistItems = (playlist.body as {
    items?: Array<{
      contentDetails?: { videoId?: string };
      snippet?: {
        title?: string;
        description?: string;
        publishedAt?: string;
        thumbnails?: {
          default?: { url?: string };
          medium?: { url?: string };
          high?: { url?: string };
          maxres?: { url?: string };
        };
      };
    }>;
  })?.items ?? [];
  const videoIds = playlistItems
    .map((p) => p.contentDetails?.videoId)
    .filter((id): id is string => typeof id === "string");
  if (videoIds.length === 0) return [];

  // Second: one videos.list call gets full stats + duration for all of them.
  const videos = await get(
    `${YT_DATA}/videos?id=${videoIds.join(",")}&part=snippet,statistics,contentDetails`,
    token,
  );
  if (videos.status !== 200) return [];
  const videoItems = (videos.body as {
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        description?: string;
        publishedAt?: string;
        thumbnails?: {
          medium?: { url?: string };
          high?: { url?: string };
          maxres?: { url?: string };
        };
      };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      contentDetails?: { duration?: string };
    }>;
  })?.items ?? [];

  return videoItems.map((v) => {
    const id = String(v.id ?? "");
    const duration_seconds = parseIsoDuration(v.contentDetails?.duration ?? "PT0S");
    // YouTube Shorts heuristic — ≤60s and the URL works as /shorts/<id>.
    // There's no dedicated isShort field; community consensus is duration ≤ 60s.
    const is_short = duration_seconds > 0 && duration_seconds <= 60;
    // Prefer `high` (hqdefault) — generated for EVERY live video. `maxres`
    // (maxresdefault) is sharper but 404s for many Shorts / SD uploads, so it's
    // only the last resort (avoids broken thumbnails).
    const thumb =
      v.snippet?.thumbnails?.high?.url ??
      v.snippet?.thumbnails?.medium?.url ??
      v.snippet?.thumbnails?.maxres?.url ??
      null;
    return {
      id,
      title: v.snippet?.title ?? "",
      description: v.snippet?.description ?? "",
      published_at: v.snippet?.publishedAt ?? "",
      duration_seconds,
      thumbnail_url: thumb,
      permalink: is_short
        ? `https://www.youtube.com/shorts/${id}`
        : `https://www.youtube.com/watch?v=${id}`,
      is_short,
      view_count: Number(v.statistics?.viewCount ?? 0),
      like_count: Number(v.statistics?.likeCount ?? 0),
      comment_count: Number(v.statistics?.commentCount ?? 0),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 28-day analytics rollup. Returns null on error so the channel section
// still renders with NULLs in the stat cells (the React component
// renders "—" for nulls).

type AnalyticsRollup = {
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  subscribersGained: number;
  subscribersLost: number;
  likes: number;
  comments: number;
  shares: number;
};

async function fetchChannelAnalytics28d(
  token: string,
): Promise<AnalyticsRollup | null> {
  // YouTube Analytics has a 2-day reporting lag — anything within
  // `now - 2d` shows up as zeros. Cap endDate at 2 days ago so the
  // average values look right even on newly-created channels.
  const end = new Date(Date.now() - 2 * 86_400 * 1000);
  const start = new Date(end.getTime() - 28 * 86_400 * 1000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const metrics = [
    "views",
    "estimatedMinutesWatched",
    "averageViewDuration",
    "subscribersGained",
    "subscribersLost",
    "likes",
    "comments",
    "shares",
  ];
  const url =
    `${YT_ANALYTICS}/reports?ids=channel==MINE` +
    `&startDate=${ymd(start)}&endDate=${ymd(end)}` +
    `&metrics=${metrics.join(",")}`;
  const r = await get(url, token);
  if (r.status !== 200) return null;
  const body = r.body as {
    columnHeaders?: Array<{ name: string }>;
    rows?: Array<Array<number>>;
  };
  const headers = body.columnHeaders?.map((h) => h.name) ?? [];
  const row = body.rows?.[0];
  if (!row) return null;
  // Map columnHeaders → row values; tolerates Google reordering columns.
  const idx = (name: string) => headers.indexOf(name);
  const numAt = (name: string): number => {
    const i = idx(name);
    if (i < 0) return 0;
    const v = row[i];
    return typeof v === "number" ? v : 0;
  };
  return {
    views: numAt("views"),
    estimatedMinutesWatched: numAt("estimatedMinutesWatched"),
    averageViewDuration: numAt("averageViewDuration"),
    subscribersGained: numAt("subscribersGained"),
    subscribersLost: numAt("subscribersLost"),
    likes: numAt("likes"),
    comments: numAt("comments"),
    shares: numAt("shares"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ISO 8601 duration parser ("PT1H2M3S" → 3723). Handles the YouTube
// shapes we'll see: PT<H>H<M>M<S>S with any combination of present
// units. Doesn't handle day/month/year (videos can't be that long).

function parseIsoDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, h, mm, s] = m;
  return Number(h ?? 0) * 3600 + Number(mm ?? 0) * 60 + Number(s ?? 0);
}
