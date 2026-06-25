/**
 * Probe every YouTube endpoint we care about for the Socials module
 * for a connected channel, using the stored refresh_token. Reports
 * which fields are populated and what the data shape looks like so
 * we can decide what to render on the YouTube card and what to store
 * in tables.
 *
 * Run:
 *   cd dashboard/web
 *   npx tsx --env-file .env.local scripts/probe-youtube-social.ts <clientSlug>
 *
 * Endpoints probed:
 *   - youtube.channels.list (mine=true)   → channel snippet + statistics
 *   - youtube.search.list (forMine=true)  → cheap recent-upload feed
 *   - youtube.playlistItems.list          → "uploads" playlist (canonical
 *                                            recent list, doesn't burn search quota)
 *   - youtube.videos.list                 → per-video statistics
 *   - youtubeAnalytics.reports.query      → channel-level daily views,
 *                                            watch time, subscribers gained
 *
 * The token stays in process and is NEVER printed.
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";
import { refreshAccessToken } from "../src/lib/youtube-oauth";

const YT_DATA = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS = "https://youtubeanalytics.googleapis.com/v2";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: probe-youtube-social.ts <clientSlug>");
    process.exit(1);
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in env");
  }

  const supabase = createAdminClient();
  const { data: client } = await supabase
    .from("clients").select("id").eq("slug", slug).maybeSingle();
  if (!client) throw new Error(`No client with slug ${slug}`);

  const { data: creds } = await supabase
    .from("client_social_credentials")
    .select(
      "access_token_secret_id, youtube_channel_id, youtube_channel_title, youtube_channel_handle",
    )
    .eq("client_id", (client as { id: string }).id)
    .eq("platform", "youtube")
    .maybeSingle();
  if (!creds) throw new Error("No YouTube credentials for this client");
  const c = creds as {
    access_token_secret_id: string;
    youtube_channel_id: string;
    youtube_channel_title: string;
    youtube_channel_handle: string | null;
  };

  const refreshToken = await getVaultSecret(supabase, c.access_token_secret_id);
  const { access_token } = await refreshAccessToken({
    clientId, clientSecret, refreshToken,
  });

  console.log(`\n=== ${slug} ===`);
  console.log(`YouTube: ${c.youtube_channel_title}  ${c.youtube_channel_handle ? `(@${c.youtube_channel_handle})` : ""}  ${c.youtube_channel_id}`);

  await probeChannel(access_token);
  const uploadsPlaylistId = await probeUploadsPlaylist(access_token);
  const firstVideoId = await probeRecentVideos(access_token, uploadsPlaylistId);
  if (firstVideoId) await probeVideoStats(access_token, firstVideoId);
  await probeChannelAnalytics(access_token, c.youtube_channel_id);
  if (firstVideoId) await probeVideoAnalytics(access_token, c.youtube_channel_id, firstVideoId);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers

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

function header(s: string) {
  console.log(`\n━━━ ${s} ${"━".repeat(Math.max(0, 60 - s.length))}`);
}

function reportFields(label: string, obj: Record<string, unknown> | undefined) {
  console.log(`\n${label}:`);
  if (!obj) { console.log("  (no body)"); return; }
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) console.log(`  ${k}: <null>`);
    else if (typeof v === "object") console.log(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
    else console.log(`  ${k}: ${String(v).slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// channels.list — channel-level identity + lifetime statistics

async function probeChannel(token: string): Promise<void> {
  header("YOUTUBE — channels.list (snippet,statistics,brandingSettings,status)");
  const r = await get(
    `${YT_DATA}/channels?mine=true&part=snippet,statistics,brandingSettings,status,contentDetails`,
    token,
  );
  console.log(`  status: ${r.status}`);
  const items = (r.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  console.log(`  count: ${items.length}`);
  if (items[0]) {
    reportFields("  snippet", items[0].snippet as Record<string, unknown>);
    reportFields("  statistics", items[0].statistics as Record<string, unknown>);
    reportFields("  status", items[0].status as Record<string, unknown>);
    // contentDetails contains the uploads playlist ID we'll use next
    reportFields("  contentDetails.relatedPlaylists",
      ((items[0].contentDetails as Record<string, unknown>)?.relatedPlaylists) as Record<string, unknown>);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// uploads playlist — canonical "all my videos newest-first" feed.
// Costs 1 quota unit per page vs search.list at 100; always prefer this.

async function probeUploadsPlaylist(token: string): Promise<string | null> {
  header("YOUTUBE — uploads playlist lookup");
  const r = await get(
    `${YT_DATA}/channels?mine=true&part=contentDetails`,
    token,
  );
  const items = (r.body as { items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> })?.items ?? [];
  const uploads = items[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
  console.log(`  uploadsPlaylistId: ${uploads ?? "<not found>"}`);
  return uploads;
}

async function probeRecentVideos(
  token: string, uploadsPlaylistId: string | null,
): Promise<string | null> {
  if (!uploadsPlaylistId) return null;
  header("YOUTUBE — playlistItems.list (uploads, last 5)");
  const r = await get(
    `${YT_DATA}/playlistItems?playlistId=${uploadsPlaylistId}` +
      `&part=snippet,contentDetails,status&maxResults=5`,
    token,
  );
  console.log(`  status: ${r.status}`);
  const items = (r.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  console.log(`  count: ${items.length}`);
  if (items[0]) {
    reportFields("  first item snippet", items[0].snippet as Record<string, unknown>);
    reportFields("  first item contentDetails", items[0].contentDetails as Record<string, unknown>);
  }
  const firstVideoId =
    (items[0]?.contentDetails as { videoId?: string } | undefined)?.videoId ?? null;
  console.log(`  firstVideoId: ${firstVideoId ?? "<none>"}`);
  return firstVideoId;
}

// ─────────────────────────────────────────────────────────────────────────────
// videos.list — per-video lifetime stats. statistics is the bread-and-butter
// (views, likes, comments). contentDetails has duration. Note: dislikeCount
// is permanently removed (returns 0 even if set).

async function probeVideoStats(token: string, videoId: string): Promise<void> {
  header(`YOUTUBE — videos.list (${videoId.slice(0, 6)}…)`);
  const r = await get(
    `${YT_DATA}/videos?id=${videoId}` +
      `&part=snippet,statistics,contentDetails,status,topicDetails,liveStreamingDetails`,
    token,
  );
  console.log(`  status: ${r.status}`);
  const items = (r.body as { items?: Array<Record<string, unknown>> })?.items ?? [];
  if (items[0]) {
    reportFields("  snippet", items[0].snippet as Record<string, unknown>);
    reportFields("  statistics", items[0].statistics as Record<string, unknown>);
    reportFields("  contentDetails", items[0].contentDetails as Record<string, unknown>);
    reportFields("  status", items[0].status as Record<string, unknown>);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube Analytics — daily channel-level reports. This is where the
// timeseries data lives (views per day, watchTime per day, subsGained
// per day). Mirrors what we'd render as a sparkline on the YouTube card.

async function probeChannelAnalytics(token: string, channelId: string): Promise<void> {
  header("YOUTUBE — analytics.reports.query (channel, last 28d)");
  const end = new Date();
  const start = new Date(end.getTime() - 28 * 86_400 * 1000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  // Channel-level daily breakdown of the core metrics.
  const metrics = [
    "views",
    "estimatedMinutesWatched",
    "averageViewDuration",
    "subscribersGained",
    "subscribersLost",
    "likes",
    "comments",
    "shares",
    "annotationImpressions",
  ];
  const url = `${YT_ANALYTICS}/reports?ids=channel==MINE` +
    `&startDate=${ymd(start)}&endDate=${ymd(end)}` +
    `&metrics=${metrics.join(",")}` +
    `&dimensions=day` +
    `&sort=day`;
  const r = await get(url, token);
  console.log(`  status: ${r.status}`);
  if (r.status !== 200) {
    console.log(`  error: ${JSON.stringify(r.body).slice(0, 400)}`);
    return;
  }
  const body = r.body as {
    columnHeaders?: Array<{ name: string }>;
    rows?: Array<Array<unknown>>;
  };
  const headers = body.columnHeaders?.map((h) => h.name) ?? [];
  const rows = body.rows ?? [];
  console.log(`  columns: ${headers.join(", ")}`);
  console.log(`  rowCount: ${rows.length}`);
  if (rows.length > 0) {
    console.log(`  firstRow: ${JSON.stringify(rows[0])}`);
    console.log(`  lastRow:  ${JSON.stringify(rows[rows.length - 1])}`);
    // Summarize totals across the window so we can sanity-check.
    const summable = ["views", "estimatedMinutesWatched", "subscribersGained", "subscribersLost", "likes", "comments", "shares"];
    for (const m of summable) {
      const idx = headers.indexOf(m);
      if (idx < 0) continue;
      const total = rows.reduce((acc, row) => acc + Number(row[idx] ?? 0), 0);
      console.log(`  Σ ${m.padEnd(28)} ${total.toLocaleString("en-US")}`);
    }
  }

  // Lifetime-equivalent (since channel inception). Some channels only
  // expose analytics from 2008 forward; we cap to a safe past date.
  header("YOUTUBE — analytics.reports.query (channel, lifetime totals)");
  const lifetimeUrl =
    `${YT_ANALYTICS}/reports?ids=channel==MINE` +
    `&startDate=2008-01-01&endDate=${ymd(end)}` +
    `&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares`;
  const r2 = await get(lifetimeUrl, token);
  console.log(`  status: ${r2.status}`);
  if (r2.status === 200) {
    const body2 = r2.body as { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<unknown>> };
    const hdrs = body2.columnHeaders?.map((h) => h.name) ?? [];
    const row = body2.rows?.[0] ?? [];
    for (let i = 0; i < hdrs.length; i++) {
      console.log(`  Σ ${hdrs[i].padEnd(30)} ${row[i] ?? "—"}`);
    }
  } else {
    console.log(`  error: ${JSON.stringify(r2.body).slice(0, 400)}`);
  }

  // Eyeball that channelId param is supported (alternative to channel==MINE).
  // Both forms work when authenticated as the channel owner.
  void channelId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-video analytics — same reports API, filtered by video. Lets us
// build per-video sparklines / "views by day" charts on the dashboard.

async function probeVideoAnalytics(
  token: string, channelId: string, videoId: string,
): Promise<void> {
  header(`YOUTUBE — analytics.reports.query (video=${videoId.slice(0, 6)}…, last 28d)`);
  const end = new Date();
  const start = new Date(end.getTime() - 28 * 86_400 * 1000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const url = `${YT_ANALYTICS}/reports?ids=channel==MINE` +
    `&startDate=${ymd(start)}&endDate=${ymd(end)}` +
    `&metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained` +
    `&dimensions=day&sort=day` +
    `&filters=video==${videoId}`;
  const r = await get(url, token);
  console.log(`  status: ${r.status}`);
  if (r.status !== 200) {
    console.log(`  error: ${JSON.stringify(r.body).slice(0, 400)}`);
    return;
  }
  const body = r.body as { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<unknown>> };
  const hdrs = body.columnHeaders?.map((h) => h.name) ?? [];
  const rows = body.rows ?? [];
  console.log(`  columns: ${hdrs.join(", ")}`);
  console.log(`  rowCount: ${rows.length}`);
  if (rows.length > 0) {
    console.log(`  firstRow: ${JSON.stringify(rows[0])}`);
    console.log(`  lastRow:  ${JSON.stringify(rows[rows.length - 1])}`);
  }
  void channelId;
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
