/**
 * Cross-platform aggregator for the new /socials page.
 *
 * Pulls the existing platform snapshot fetchers in parallel and stitches
 * the data into the shapes the /socials UI needs:
 *
 *   - tiles    → totals row at top (followers / impressions / engagements
 *                 / profile visits / link clicks across all connected
 *                 platforms for the last 28 days)
 *   - perPlatform → per-platform breakdown table (rows for each connected
 *                   platform, including a "pending" status for LinkedIn
 *                   until Microsoft approves the API)
 *
 * Phase 1 uses the live fetchers we shipped for the admin snapshot panels
 * (Meta + YouTube + TikTok). LinkedIn is included as a placeholder row
 * until the Community Management API access lands. Time-series data for
 * the main chart is NOT computed here — Phase 1 ships without the chart
 * to avoid baking in a half-real visual; chart support comes when the
 * proper *_daily tables + cron land in Phase 2.
 *
 * All values represent the "last 28 days" window where applicable.
 * Period switching (7d / 90d / lifetime) requires the Phase 2 data layer.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchMetaSnapshot, type MetaSnapshotResult } from "@/lib/meta-data";
import { fetchYoutubeSnapshot, type YoutubeSnapshotResult } from "@/lib/youtube-data";
import { fetchTiktokSnapshot, type TiktokSnapshotResult } from "@/lib/tiktok-data";

export type PlatformKey = "meta_facebook" | "meta_instagram" | "youtube" | "tiktok" | "linkedin";

export type PlatformRow = {
  key: PlatformKey;
  label: string;          // "Instagram @varbleorthodontics" etc.
  handle: string | null;
  connected: boolean;
  pending?: boolean;      // true when OAuth is configured but API access pending review (LinkedIn)
  followers: number | null;
  followers_change_28d: number | null;   // delta over the period — null when not yet computable
  growth_pct_28d: number | null;
  /** Per-platform period totals. Null where the platform doesn't expose. */
  impressions_28d: number | null;
  engagements_28d: number | null;
  profile_visits_28d: number | null;
  link_clicks_28d: number | null;
  error?: string;
};

export type MetricKey = "followers" | "impressions" | "engagements" | "profile_visits" | "link_clicks";

/** Everything a tile's info tooltip needs to render dynamically — the base
 *  definition plus exactly which connected platforms feed it (and which
 *  connected platforms structurally can't). Lets the UI say "Facebook 431 ·
 *  Instagram 1.6K" instead of a static blurb that name-drops platforms the
 *  client hasn't connected. */
export type TileBreakdown = {
  /** One-line explanation of what the metric counts. */
  definition: string;
  /** Connected platforms that returned a value, with that value. */
  contributors: Array<{ label: string; value: number }>;
  /** Connected platforms that can't report this metric at all (e.g.
   *  YouTube/TikTok for profile visits + link clicks). Names only. */
  nonContributors: string[];
};

export type SocialsAggregate = {
  /** Period covered by every "_28d" field. Hardcoded for Phase 1. */
  periodLabel: string;
  /** Cross-platform sums for the metric tiles. Null when no connected
   *  platform exposes that metric. */
  tiles: {
    followers: number | null;
    impressions: number | null;
    engagements: number | null;
    profile_visits: number | null;
    link_clicks: number | null;
  };
  /** Per-tile, per-platform breakdown for the info tooltips. */
  tileBreakdown: Record<MetricKey, TileBreakdown>;
  /** Per-platform rows for the breakdown table. */
  perPlatform: PlatformRow[];
  /** How many of the 5 platform slots are actively connected (excludes
   *  pending). Drives the "Connect your social accounts" empty state. */
  connectedCount: number;
};

/** Short platform display name for tooltips (the platform, not the account). */
const PLATFORM_NAMES: Record<PlatformKey, string> = {
  meta_facebook: "Facebook",
  meta_instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

/** Which platforms can report each metric at all. Used to list
 *  "doesn't report this" platforms in tooltips (vs. just-missing data). */
const METRIC_CAPABILITY: Record<MetricKey, ReadonlySet<PlatformKey>> = {
  followers: new Set(["meta_facebook", "meta_instagram", "youtube", "tiktok", "linkedin"]),
  impressions: new Set(["meta_facebook", "meta_instagram", "youtube", "tiktok", "linkedin"]),
  engagements: new Set(["meta_facebook", "meta_instagram", "youtube", "tiktok", "linkedin"]),
  // Profile visits + link clicks: only Meta (FB/IG) and LinkedIn expose
  // them. YouTube + TikTok have no equivalent in their organic APIs.
  profile_visits: new Set(["meta_facebook", "meta_instagram", "linkedin"]),
  link_clicks: new Set(["meta_facebook", "meta_instagram", "linkedin"]),
};

const METRIC_DEFINITIONS: Record<MetricKey, string> = {
  followers: "Total followers and subscribers across your connected accounts, measured at the end of the period.",
  impressions: "How many times your content was shown, including repeat views, summed across your connected platforms.",
  engagements: "Likes, comments, shares, saves, and reactions on your posts during the period, summed across platforms.",
  profile_visits: "Times people viewed your profile or Page during the period.",
  link_clicks: "Outbound clicks on your bio link and post link buttons during the period.",
};

/** Pull a row's value for a given metric. */
function rowMetric(row: PlatformRow, metric: MetricKey): number | null {
  switch (metric) {
    case "followers": return row.followers;
    case "impressions": return row.impressions_28d;
    case "engagements": return row.engagements_28d;
    case "profile_visits": return row.profile_visits_28d;
    case "link_clicks": return row.link_clicks_28d;
  }
}

/** Build the dynamic tooltip data for one metric from the platform rows. */
function buildBreakdown(rows: PlatformRow[], metric: MetricKey): TileBreakdown {
  // Only "live" rows count — exclude pending (LinkedIn) and errored rows.
  const live = rows.filter((r) => r.connected && !r.pending && !r.error);
  const contributors: Array<{ label: string; value: number }> = [];
  const nonContributors: string[] = [];
  for (const r of live) {
    const capable = METRIC_CAPABILITY[metric].has(r.key);
    const value = rowMetric(r, metric);
    if (capable && typeof value === "number") {
      contributors.push({ label: PLATFORM_NAMES[r.key], value });
    } else if (!capable) {
      nonContributors.push(PLATFORM_NAMES[r.key]);
    }
    // capable-but-null (e.g. FB link clicks came back empty) → silently
    // omitted; the metric just isn't shown for that platform.
  }
  return { definition: METRIC_DEFINITIONS[metric], contributors, nonContributors };
}

export async function fetchSocialsAggregate(args: {
  clientId: string;
}): Promise<SocialsAggregate> {
  const supabase = createAdminClient();

  // Which platforms does this client have a credential row for? We need
  // this to know whether to even attempt a fetch (the fetchers throw if
  // there's no creds row, which is fine but slower than gating up front).
  const { data: credRows } = await supabase
    .from("client_social_credentials")
    .select("platform")
    .eq("client_id", args.clientId);
  const connected = new Set<string>((credRows ?? []).map((r) => (r as { platform: string }).platform));

  // Fan out — only call the fetcher if there's a credential row.
  const [meta, youtube, tiktok] = await Promise.all([
    connected.has("meta")    ? fetchMetaSnapshot({ clientId: args.clientId })    : Promise.resolve(null),
    connected.has("youtube") ? fetchYoutubeSnapshot({ clientId: args.clientId }) : Promise.resolve(null),
    connected.has("tiktok")  ? fetchTiktokSnapshot({ clientId: args.clientId })  : Promise.resolve(null),
  ]);

  const perPlatform: PlatformRow[] = [];

  // ── Meta: produces TWO rows (one Facebook Page, one IG) since they're
  //    fundamentally different platforms even though they share one OAuth.
  if (connected.has("meta")) {
    const m = meta as MetaSnapshotResult | null;
    if (m && m.ok) {
      perPlatform.push({
        key: "meta_facebook",
        label: m.page.name,
        handle: null,
        connected: true,
        followers: m.page.followers_count || m.page.fan_count,
        followers_change_28d: null,   // no historical follower data yet → Phase 2
        growth_pct_28d: null,
        impressions_28d: m.page.impressions_28d,      // page_media_view (28d)
        engagements_28d: m.page.engagements_28d,       // page_post_engagements (28d)
        profile_visits_28d: m.page.profile_views_28d,  // page_views_total (28d)
        link_clicks_28d: m.page.link_clicks_28d,       // summed post link clicks (28d)
      });
      if (m.ig) {
        const ig = m.ig;
        perPlatform.push({
          key: "meta_instagram",
          label: `@${ig.username}`,
          handle: ig.username,
          connected: true,
          followers: ig.followers_count,
          followers_change_28d: null,
          growth_pct_28d: null,
          impressions_28d: ig.views_28d,             // account-level views (28d) — replaces deprecated impressions
          engagements_28d: ig.total_interactions_28d, // account-level total_interactions (28d)
          profile_visits_28d: ig.profile_views_28d,   // profile_views (28d)
          link_clicks_28d: ig.website_clicks_28d,      // website_clicks — bio link taps (28d)
        });
      }
    } else {
      perPlatform.push(errorRow("meta_facebook", "Facebook Page", m && !m.ok ? m.error : "Snapshot unavailable"));
    }
  }

  // ── YouTube
  if (connected.has("youtube")) {
    const y = youtube as YoutubeSnapshotResult | null;
    if (y && y.ok) {
      const eng28 = (y.channel.likes_28d ?? 0) + (y.channel.comments_28d ?? 0) + (y.channel.shares_28d ?? 0);
      perPlatform.push({
        key: "youtube",
        // Strip any leading "@" — YouTube handles already include it, and
        // the table re-adds one (was rendering "@@postedsocial").
        label: y.channel.title,
        handle: y.channel.handle ? y.channel.handle.replace(/^@+/, "") : null,
        connected: true,
        followers: y.channel.subscriber_count,
        followers_change_28d: (y.channel.subs_gained_28d ?? 0) - (y.channel.subs_lost_28d ?? 0),
        growth_pct_28d: y.channel.subscriber_count > 0
          ? (((y.channel.subs_gained_28d ?? 0) - (y.channel.subs_lost_28d ?? 0)) / y.channel.subscriber_count) * 100
          : null,
        impressions_28d: y.channel.views_28d,
        engagements_28d: eng28 || null,
        profile_visits_28d: null,
        link_clicks_28d: null,
      });
    } else {
      perPlatform.push(errorRow("youtube", "YouTube channel", y && !y.ok ? y.error : "Snapshot unavailable"));
    }
  }

  // ── TikTok
  if (connected.has("tiktok")) {
    const t = tiktok as TiktokSnapshotResult | null;
    if (t && t.ok) {
      // TikTok doesn't expose a 28-day window — sum the recent videos
      // page as a rough approximation. Real period totals require the
      // Phase 2 daily-snapshot data layer.
      const pageViews = t.videos.reduce((acc, v) => acc + v.view_count, 0);
      const pageEng = t.videos.reduce((acc, v) => acc + v.like_count + v.comment_count + v.share_count, 0);
      perPlatform.push({
        key: "tiktok",
        label: t.user.display_name,
        handle: t.user.username,
        connected: true,
        followers: t.user.follower_count,
        followers_change_28d: null,
        growth_pct_28d: null,
        impressions_28d: pageViews || null,
        engagements_28d: pageEng || null,
        profile_visits_28d: null,
        link_clicks_28d: null,
      });
    } else {
      perPlatform.push(errorRow("tiktok", "TikTok account", t && !t.ok ? t.error : "Snapshot unavailable"));
    }
  }

  // ── LinkedIn — pending Microsoft API approval. Render as a "pending"
  //    row so the table makes the gap visible without breaking the layout.
  if (connected.has("linkedin")) {
    perPlatform.push({
      key: "linkedin",
      label: "LinkedIn Company Page",
      handle: null,
      connected: true,
      pending: true,
      followers: null,
      followers_change_28d: null,
      growth_pct_28d: null,
      impressions_28d: null,
      engagements_28d: null,
      profile_visits_28d: null,
      link_clicks_28d: null,
    });
  }

  // ── Cross-platform sums for the tile bar. Sum where any platform has
  //    data; return null if no platform exposes the metric.
  const sum = (vals: Array<number | null>) => {
    const present = vals.filter((v): v is number => typeof v === "number");
    return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
  };

  const tiles = {
    followers: sum(perPlatform.map((r) => r.followers)),
    impressions: sum(perPlatform.map((r) => r.impressions_28d)),
    engagements: sum(perPlatform.map((r) => r.engagements_28d)),
    profile_visits: sum(perPlatform.map((r) => r.profile_visits_28d)),
    link_clicks: sum(perPlatform.map((r) => r.link_clicks_28d)),
  };

  const tileBreakdown: Record<MetricKey, TileBreakdown> = {
    followers: buildBreakdown(perPlatform, "followers"),
    impressions: buildBreakdown(perPlatform, "impressions"),
    engagements: buildBreakdown(perPlatform, "engagements"),
    profile_visits: buildBreakdown(perPlatform, "profile_visits"),
    link_clicks: buildBreakdown(perPlatform, "link_clicks"),
  };

  return {
    periodLabel: "Last 28 days",
    tiles,
    tileBreakdown,
    perPlatform,
    connectedCount: perPlatform.filter((r) => r.connected && !r.pending && !r.error).length,
  };
}

function errorRow(key: PlatformKey, label: string, error: string): PlatformRow {
  return {
    key, label, handle: null,
    connected: true,
    followers: null, followers_change_28d: null, growth_pct_28d: null,
    impressions_28d: null, engagements_28d: null,
    profile_visits_28d: null, link_clicks_28d: null,
    error,
  };
}
