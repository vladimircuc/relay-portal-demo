/**
 * Server-side Meta (Facebook Page + Instagram Business) data fetcher
 * for the admin "Account snapshot" panel. Mirror of `lib/tiktok-data.ts`.
 *
 * Single entry point — `fetchMetaSnapshot()` — that, given a client_id:
 *   1. Loads the stored long-lived Page access token from Vault
 *   2. Calls Graph API endpoints for:
 *      - Page basics (name, fan/follower counts, picture)         → instagram_basic
 *      - Page recent posts with engagement                        → pages_read_engagement
 *      - Page-level Insights (post engagement, 28-day window)     → read_insights
 *      - IG basics (username, followers, media count, avatar)     → instagram_basic
 *      - IG recent media (cover, caption, like/comment counts)    → instagram_basic
 *      - IG account-level Insights (reach, 28-day window)         → instagram_manage_insights
 *   3. Returns a typed payload the React component renders directly
 *
 * Why this lives separately from the existing ETL (lib/etl/meta.ts) —
 * the existing ETL pulls Marketing API data (ads_read scope). This file
 * fetches ORGANIC analytics, which is a different scope set and a
 * different surface in the product.
 *
 * Why live calls (vs ETL + cached tables) — same reason as TikTok: this
 * is the OAuth-review demo surface + agency-operator verification.
 * Hitting the API live on each render is the lowest-commitment way to
 * show data flowing through the requested scopes. A daily ETL writing
 * to `meta_organic_*` tables can replace this fetcher later when we
 * ship the full Socials module.
 *
 * Failure mode: returns `{ ok: false, error: "..." }`. Callers are
 * server components and handle the error inline.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "@/lib/etl/vault";
import { META_API_VERSION } from "@/lib/meta-oauth";

const G = `https://graph.facebook.com/${META_API_VERSION}`;

export type MetaSnapshot = {
  ok: true;
  page: {
    id: string;
    name: string;
    fan_count: number;
    followers_count: number;
    picture_url: string | null;
    link: string | null;
    about: string | null;
    /** Sum of `page_post_engagements` over the last 28 days. */
    engagements_28d: number | null;
    /** Sum of `page_media_view` over 28d — Meta's replacement for the
     *  deprecated `page_impressions`. This is the "Impressions" number
     *  Plannable shows for a Facebook Page. */
    impressions_28d: number | null;
    /** Sum of `page_views_total` over 28d — Page profile visits. */
    profile_views_28d: number | null;
    /** Summed per-post `link clicks` (post_clicks_by_type) over 28d.
     *  Best-effort: null if Meta no longer returns the metric. */
    link_clicks_28d: number | null;
  };
  posts: Array<{
    id: string;
    message: string;
    created_time: string;
    permalink_url: string;
    picture_url: string | null;
    attachment_type: string | null;
    reactions: number;
    comments: number;
    shares: number;
  }>;
  ig: {
    id: string;
    username: string;
    name: string | null;
    biography: string | null;
    followers_count: number;
    follows_count: number;
    media_count: number;
    profile_picture_url: string | null;
    /** Account-level reach over the last 28 days (total_value). */
    reach_28d: number | null;
    /** Account-level `views` over 28d — Meta's replacement for the
     *  deprecated IG `impressions`. This is the IG "Impressions" number. */
    views_28d: number | null;
    /** Account-level `total_interactions` over 28d — IG engagements
     *  (likes + comments + saves + shares across all media). */
    total_interactions_28d: number | null;
    /** Account-level `profile_views` over 28d — IG profile visits. */
    profile_views_28d: number | null;
    /** Account-level `website_clicks` over 28d — taps on the bio link. */
    website_clicks_28d: number | null;
  } | null;
  media: Array<{
    id: string;
    caption: string;
    media_type: string;
    media_product_type: string | null;
    thumbnail_url: string;
    permalink: string;
    timestamp: string;
    like_count: number;
    comments_count: number;
  }>;
};

export type MetaSnapshotResult = MetaSnapshot | { ok: false; error: string };

export async function fetchMetaSnapshot(args: {
  clientId: string;
}): Promise<MetaSnapshotResult> {
  try {
    const supabase = createAdminClient();

    const { data: creds } = await supabase
      .from("client_social_credentials")
      .select("access_token_secret_id, fb_page_id, fb_page_name, ig_user_id, ig_username")
      .eq("client_id", args.clientId)
      .eq("platform", "meta")
      .maybeSingle();

    if (!creds) return { ok: false, error: "No Meta credential row for this client." };
    const c = creds as {
      access_token_secret_id: string;
      fb_page_id: string;
      fb_page_name: string | null;
      ig_user_id: string | null;
      ig_username: string | null;
    };

    // Long-lived Page access token. Doesn't expire as long as the user
    // remains a Page admin, so no refresh dance needed (unlike TikTok).
    const token = await getVaultSecret(supabase, c.access_token_secret_id);

    // Pull all payloads in parallel — they're independent reads and
    // Graph API is fast enough that fan-out is the right call.
    const [page, posts, pageInsights, pageLinkClicks, ig, media, igInsights] = await Promise.all([
      fetchPageBasics(token, c.fb_page_id),
      fetchPagePosts(token, c.fb_page_id, 6),
      fetchPageInsights28d(token, c.fb_page_id),
      fetchPageLinkClicks28d(token, c.fb_page_id),
      c.ig_user_id ? fetchIgBasics(token, c.ig_user_id) : Promise.resolve(null),
      c.ig_user_id ? fetchIgMedia(token, c.ig_user_id, 6) : Promise.resolve([]),
      c.ig_user_id ? fetchIgPeriodInsights(token, c.ig_user_id) : Promise.resolve(null),
    ]);

    if (!page.ok) return { ok: false, error: page.error };

    // Merge the parallel-fetched IG period insights into the ig object
    // before returning, so the React component sees one shape.
    const igWithInsights = ig
      ? {
          ...ig,
          reach_28d: igInsights?.reach ?? null,
          views_28d: igInsights?.views ?? null,
          total_interactions_28d: igInsights?.totalInteractions ?? null,
          profile_views_28d: igInsights?.profileViews ?? null,
          website_clicks_28d: igInsights?.websiteClicks ?? null,
        }
      : null;

    return {
      ok: true,
      page: {
        id: c.fb_page_id,
        name: page.value.name,
        fan_count: page.value.fan_count,
        followers_count: page.value.followers_count,
        picture_url: page.value.picture_url,
        link: page.value.link,
        about: page.value.about,
        engagements_28d: pageInsights.engagements,
        impressions_28d: pageInsights.impressions,
        profile_views_28d: pageInsights.profileViews,
        link_clicks_28d: pageLinkClicks,
      },
      posts: posts,
      ig: igWithInsights,
      media: media,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Meta snapshot failed." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helper. Meta returns { error } at HTTP 200 OR raw status codes —
// always inspect the body even on a 200.

async function get(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function inspect(label: string, r: { status: number; body: unknown }): { ok: true } | { ok: false; error: string } {
  if (r.status !== 200) {
    const err = (r.body as { error?: { message?: string; code?: number } })?.error;
    return { ok: false, error: `${label} ${r.status}: ${err?.message ?? JSON.stringify(r.body).slice(0, 200)}` };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Facebook Page

type PageBasics = {
  name: string;
  fan_count: number;
  followers_count: number;
  picture_url: string | null;
  link: string | null;
  about: string | null;
};

async function fetchPageBasics(
  token: string, pageId: string,
): Promise<{ ok: true; value: PageBasics } | { ok: false; error: string }> {
  const fields = "name,fan_count,followers_count,link,about,picture.type(large)";
  const r = await get(`${G}/${pageId}?fields=${fields}&access_token=${token}`);
  const ins = inspect("page basics", r);
  if (!ins.ok) return ins;
  const body = r.body as {
    name?: string;
    fan_count?: number;
    followers_count?: number;
    link?: string;
    about?: string;
    picture?: { data?: { url?: string } };
  };
  return {
    ok: true,
    value: {
      name: body.name ?? "",
      fan_count: Number(body.fan_count ?? 0),
      followers_count: Number(body.followers_count ?? body.fan_count ?? 0),
      picture_url: body.picture?.data?.url ?? null,
      link: body.link ?? null,
      about: body.about ?? null,
    },
  };
}

async function fetchPagePosts(
  token: string, pageId: string, limit: number,
): Promise<MetaSnapshot["posts"]> {
  // .summary(total_count) on the reactions / comments edges returns just
  // the aggregate number without paging through every comment. shares is
  // an object { count } on the post itself.
  const fields = [
    "id", "message", "created_time", "permalink_url", "full_picture",
    "attachments{media_type,title}",
    "reactions.summary(total_count).limit(0)",
    "comments.summary(total_count).limit(0)",
    "shares",
  ].join(",");
  const r = await get(`${G}/${pageId}/posts?fields=${fields}&limit=${limit}&access_token=${token}`);
  if (r.status !== 200) return [];
  const list = (r.body as { data?: Array<Record<string, unknown>> })?.data ?? [];
  return list.map((p) => ({
    id: String(p.id ?? ""),
    message: String(p.message ?? ""),
    created_time: String(p.created_time ?? ""),
    permalink_url: String(p.permalink_url ?? ""),
    picture_url: (p.full_picture as string | undefined) ?? null,
    attachment_type:
      ((p.attachments as { data?: Array<{ media_type?: string }> } | undefined)?.data?.[0]?.media_type) ?? null,
    reactions:
      Number(((p.reactions as { summary?: { total_count?: number } } | undefined)?.summary?.total_count) ?? 0),
    comments:
      Number(((p.comments as { summary?: { total_count?: number } } | undefined)?.summary?.total_count) ?? 0),
    shares:
      Number(((p.shares as { count?: number } | undefined)?.count) ?? 0),
  }));
}

async function fetchPageInsights28d(
  token: string, pageId: string,
): Promise<{ engagements: number | null; impressions: number | null; profileViews: number | null }> {
  // One call for the three daily Page metrics that survived Meta's 2024
  // Page Insights deprecation:
  //   - page_post_engagements → "Engagements"
  //   - page_media_view       → "Impressions" (replaces dead page_impressions;
  //                              this is the big number Plannable shows)
  //   - page_views_total      → "Profile visits" (alive despite the
  //                              deprecation notice Meta posted)
  // Each comes back as a daily time series; we sum the window.
  const metrics = "page_post_engagements,page_media_view,page_views_total";
  const r = await get(
    `${G}/${pageId}/insights?metric=${metrics}&period=day&date_preset=last_28d&access_token=${token}`,
  );
  const empty = { engagements: null, impressions: null, profileViews: null };
  if (r.status !== 200) return empty;
  const data = (r.body as { data?: Array<{ name?: string; values?: Array<{ value?: number }> }> })?.data ?? [];
  const sumOf = (name: string): number | null => {
    const entry = data.find((d) => d.name === name);
    if (!entry || !entry.values || entry.values.length === 0) return null;
    return entry.values.reduce((acc, v) => acc + Number(v.value ?? 0), 0);
  };
  return {
    engagements: sumOf("page_post_engagements"),
    impressions: sumOf("page_media_view"),
    profileViews: sumOf("page_views_total"),
  };
}

async function fetchPageLinkClicks28d(
  token: string, pageId: string,
): Promise<number | null> {
  // Meta killed page-level click metrics in 2024, so link clicks have to
  // be summed per-post via post_clicks_by_type (we extract the "link
  // clicks" bucket). Bounded to one page of up to 50 posts in the last
  // 28 days — covers any realistic posting cadence. Best-effort: returns
  // null if Meta no longer surfaces the metric (the whole posts call 400s
  // or the insights edge comes back empty), in which case IG carries the
  // Link clicks tile on its own.
  const since = Math.floor((Date.now() - 28 * 86_400_000) / 1000);
  const r = await get(
    `${G}/${pageId}/posts?since=${since}&limit=50&fields=insights.metric(post_clicks_by_type)&access_token=${token}`,
  );
  if (r.status !== 200) return null;
  const list = (r.body as {
    data?: Array<{ insights?: { data?: Array<{ values?: Array<{ value?: Record<string, number> }> }> } }>;
  })?.data ?? [];
  let sum = 0;
  let found = false;
  for (const p of list) {
    const value = p.insights?.data?.[0]?.values?.[0]?.value;
    if (value && typeof value === "object") {
      const linkClicks = value["link clicks"] ?? value["link_clicks"] ?? 0;
      sum += Number(linkClicks) || 0;
      found = true;
    }
  }
  return found ? sum : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram Business Account

async function fetchIgBasics(
  token: string, igUserId: string,
): Promise<MetaSnapshot["ig"]> {
  const fields = "id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url";
  const r = await get(`${G}/${igUserId}?fields=${fields}&access_token=${token}`);
  if (r.status !== 200) return null;
  const body = r.body as {
    id?: string;
    username?: string;
    name?: string;
    biography?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    profile_picture_url?: string;
  };
  if (!body.id || !body.username) return null;
  return {
    id: body.id,
    username: body.username,
    name: body.name ?? null,
    biography: body.biography ?? null,
    followers_count: Number(body.followers_count ?? 0),
    follows_count: Number(body.follows_count ?? 0),
    media_count: Number(body.media_count ?? 0),
    profile_picture_url: body.profile_picture_url ?? null,
    // Filled in by fetchIgPeriodInsights which runs in parallel; we merge
    // the values back at the call site (Promise.all preserves order).
    reach_28d: null,
    views_28d: null,
    total_interactions_28d: null,
    profile_views_28d: null,
    website_clicks_28d: null,
  };
}

async function fetchIgMedia(
  token: string, igUserId: string, limit: number,
): Promise<MetaSnapshot["media"]> {
  const fields = [
    "id", "caption", "media_type", "media_product_type",
    "media_url", "thumbnail_url", "permalink", "timestamp",
    "like_count", "comments_count",
  ].join(",");
  const r = await get(`${G}/${igUserId}/media?fields=${fields}&limit=${limit}&access_token=${token}`);
  if (r.status !== 200) return [];
  const list = (r.body as { data?: Array<Record<string, unknown>> })?.data ?? [];
  return list.map((m) => ({
    id: String(m.id ?? ""),
    caption: String(m.caption ?? ""),
    media_type: String(m.media_type ?? ""),
    media_product_type: (m.media_product_type as string | undefined) ?? null,
    // VIDEO media_type uses thumbnail_url; IMAGE/CAROUSEL_ALBUM use media_url.
    // Reels expose thumbnail_url. Fall back to media_url for static images.
    thumbnail_url: String(m.thumbnail_url ?? m.media_url ?? ""),
    permalink: String(m.permalink ?? ""),
    timestamp: String(m.timestamp ?? ""),
    like_count: Number(m.like_count ?? 0),
    comments_count: Number(m.comments_count ?? 0),
  }));
}

type IgPeriodInsights = {
  views: number | null;
  reach: number | null;
  totalInteractions: number | null;
  profileViews: number | null;
  websiteClicks: number | null;
};

async function fetchIgPeriodInsights(
  token: string, igUserId: string,
): Promise<IgPeriodInsights> {
  // Account-level IG insights for the last 28 days. metric_type=total_value
  // returns one aggregate per metric over the [since, until] window — which
  // is the headline number we want. (The OLD code requested `reach` with NO
  // window, so the API defaulted to ~24h — that's why the tile read 3.4K
  // instead of a real 28-day figure.)
  //
  // Split into two calls on purpose: the "core" metrics (views/reach/
  // interactions) are rock-solid, while profile_views/website_clicks are
  // occasionally gated per account. Isolating them means a failure in the
  // extras never nukes the impressions/engagements numbers.
  const since = Math.floor((Date.now() - 28 * 86_400_000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const [core, extras] = await Promise.all([
    igTotalValues(token, igUserId, "views,reach,total_interactions", since, until),
    igTotalValues(token, igUserId, "profile_views,website_clicks", since, until),
  ]);
  return {
    views: core["views"] ?? null,
    reach: core["reach"] ?? null,
    totalInteractions: core["total_interactions"] ?? null,
    profileViews: extras["profile_views"] ?? null,
    websiteClicks: extras["website_clicks"] ?? null,
  };
}

async function igTotalValues(
  token: string, igUserId: string, metrics: string, since: number, until: number,
): Promise<Record<string, number>> {
  const r = await get(
    `${G}/${igUserId}/insights?metric=${metrics}&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${token}`,
  );
  if (r.status !== 200) return {};
  const data = (r.body as {
    data?: Array<{ name?: string; total_value?: { value?: number } }>;
  })?.data ?? [];
  const out: Record<string, number> = {};
  for (const d of data) {
    if (d.name && typeof d.total_value?.value === "number") out[d.name] = d.total_value.value;
  }
  return out;
}
