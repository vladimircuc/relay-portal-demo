/**
 * Probe every Meta endpoint we care about for the Socials module —
 * Facebook Page + connected Instagram Business Account — using the
 * stored Page access token. Reports which fields are populated, which
 * are deprecated/empty, and what the data shape actually looks like.
 *
 * Run:
 *   cd dashboard/web
 *   npx tsx --env-file .env.local scripts/probe-meta-social.ts <clientSlug>
 *
 * The token stays in process and is NEVER printed.
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";

const META_API_VERSION = "v25.0";
const G = `https://graph.facebook.com/${META_API_VERSION}`;

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: probe-meta-social.ts <clientSlug>");
    process.exit(1);
  }

  const supabase = createAdminClient();
  const { data: client } = await supabase
    .from("clients").select("id").eq("slug", slug).maybeSingle();
  if (!client) throw new Error(`No client with slug ${slug}`);

  const { data: creds } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, fb_page_id, fb_page_name, ig_user_id, ig_username")
    .eq("client_id", (client as { id: string }).id).eq("platform", "meta").maybeSingle();
  if (!creds) throw new Error("No meta credentials for this client");
  const c = creds as {
    access_token_secret_id: string;
    fb_page_id: string;
    fb_page_name: string;
    ig_user_id: string | null;
    ig_username: string | null;
  };

  const token = await getVaultSecret(supabase, c.access_token_secret_id);

  console.log(`\n=== ${slug} ===`);
  console.log(`FB Page: ${c.fb_page_name}  (${c.fb_page_id})`);
  console.log(`IG: @${c.ig_username ?? "—"}  (${c.ig_user_id ?? "—"})`);

  await probeFacebook(token, c.fb_page_id);
  if (c.ig_user_id) await probeInstagram(token, c.ig_user_id);
}

/** Compact wrapper: GET a Graph endpoint, return parsed JSON + status. */
async function get(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { cache: "no-store" });
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
    else if (typeof v === "object") console.log(`  ${k}: ${JSON.stringify(v).slice(0, 100)}`);
    else console.log(`  ${k}: ${String(v).slice(0, 100)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Facebook

async function probeFacebook(token: string, pageId: string) {
  header("FACEBOOK — Page basics");
  // Most common Page fields — followers, fan_count, about, category, link
  const basicFields = [
    "id", "name", "username", "fan_count", "followers_count",
    "category", "about", "link", "verification_status",
    "phone", "website", "emails", "is_published",
  ].join(",");
  const basic = await get(`${G}/${pageId}?fields=${basicFields}&access_token=${token}`);
  console.log(`  status: ${basic.status}`);
  reportFields("  fields", basic.body as Record<string, unknown>);

  header("FACEBOOK — Page Insights (day period)");
  // The metrics we care about for "Socials" — engagement, post clicks, reach.
  // Most reach/impressions metrics deprecate June 30, 2026 → replaced by
  // page_media_view / page_media_viewer. We probe both to see which works.
  const dayMetrics = [
    "page_post_engagements",
    "page_impressions_unique",
    "page_impressions",
    "page_media_view",      // post-deprecation replacement
    "page_views_total",      // deprecated since March 2024 — expect empty
    "page_fan_adds",
    "page_fan_removes",
  ];
  for (const m of dayMetrics) {
    const r = await get(
      `${G}/${pageId}/insights?metric=${m}&period=day&access_token=${token}`,
    );
    summarizeInsight(m, r);
  }

  header("FACEBOOK — Recent posts (last 5)");
  const posts = await get(
    `${G}/${pageId}/posts?` +
      `fields=id,message,created_time,permalink_url,attachments{media_type,title}` +
      `&limit=5&access_token=${token}`,
  );
  console.log(`  status: ${posts.status}`);
  const postList = (posts.body as { data?: Array<Record<string, unknown>> })?.data ?? [];
  console.log(`  count: ${postList.length}`);
  if (postList[0]) reportFields("  first post sample", postList[0]);

  // For the first post, try post-level insights
  if (postList[0]) {
    header("FACEBOOK — Per-post insights (first post)");
    const postId = postList[0].id as string;
    const postMetrics = [
      "post_clicks",
      "post_clicks_by_type",
      "post_impressions_unique",
      "post_impressions_organic_unique",
      "post_reactions_like_total",
      "post_reactions_by_type_total",
      "post_activity_by_action_type",
      "post_media_view",        // replacement for post_impressions
      "post_video_views",       // for video posts; will be null otherwise
    ];
    for (const m of postMetrics) {
      const r = await get(
        `${G}/${postId}/insights?metric=${m}&access_token=${token}`,
      );
      summarizeInsight(m, r);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Instagram

async function probeInstagram(token: string, igUserId: string) {
  header("INSTAGRAM — Account basics");
  const basicFields = [
    "id", "username", "name", "biography",
    "followers_count", "follows_count", "media_count",
    "website", "profile_picture_url",
  ].join(",");
  const basic = await get(`${G}/${igUserId}?fields=${basicFields}&access_token=${token}`);
  console.log(`  status: ${basic.status}`);
  reportFields("  fields", basic.body as Record<string, unknown>);

  header("INSTAGRAM — Account Insights (day)");
  // Currently-available account-level metrics per v25 docs. We probe
  // both the live ones AND the dead ones (profile_views, website_clicks)
  // so the report makes it crystal clear which are gone.
  const dayMetrics: Array<{ metric: string; metricType?: "total_value" }> = [
    { metric: "views",                       metricType: "total_value" },
    { metric: "reach",                       metricType: "total_value" },
    { metric: "accounts_engaged",            metricType: "total_value" },
    { metric: "total_interactions",          metricType: "total_value" },
    { metric: "likes",                       metricType: "total_value" },
    { metric: "comments",                    metricType: "total_value" },
    { metric: "shares",                      metricType: "total_value" },
    { metric: "saves",                       metricType: "total_value" },
    { metric: "replies",                     metricType: "total_value" },
    { metric: "profile_links_taps",          metricType: "total_value" },
    { metric: "follows_and_unfollows",       metricType: "total_value" },
    { metric: "profile_views" }, // expect deprecated
    { metric: "website_clicks" }, // expect deprecated
    { metric: "impressions" },    // replaced by views
  ];
  // Insights need a since/until window; use last 28 days.
  const until = Math.floor(Date.now() / 1000);
  const since = until - 28 * 86_400;
  for (const m of dayMetrics) {
    const tail = m.metricType ? `&metric_type=${m.metricType}` : "";
    const r = await get(
      `${G}/${igUserId}/insights?metric=${m.metric}&period=day&since=${since}&until=${until}${tail}&access_token=${token}`,
    );
    summarizeInsight(m.metric, r);
  }

  header("INSTAGRAM — Recent media (last 5)");
  const media = await get(
    `${G}/${igUserId}/media?` +
      `fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count` +
      `&limit=5&access_token=${token}`,
  );
  console.log(`  status: ${media.status}`);
  const mediaList = (media.body as { data?: Array<Record<string, unknown>> })?.data ?? [];
  console.log(`  count: ${mediaList.length}`);
  if (mediaList[0]) reportFields("  first media sample", mediaList[0]);

  // Per-media insights for the first item
  if (mediaList[0]) {
    header("INSTAGRAM — Per-media insights (first item)");
    const mediaId = mediaList[0].id as string;
    const productType = mediaList[0].media_product_type as string | undefined;
    // The metric set differs by product type. We try the common set;
    // Meta returns errors for inapplicable ones and we report them.
    const mediaMetrics = [
      "reach",
      "views",                  // replaces impressions
      "saved",
      "shares",
      "likes",
      "comments",
      "total_interactions",
      "follows",                // available on Reels only
      "profile_visits",         // available on some media types
      "profile_activity",       // taps that left the post
    ];
    console.log(`  media_product_type: ${productType ?? "?"}`);
    for (const m of mediaMetrics) {
      const r = await get(
        `${G}/${mediaId}/insights?metric=${m}&access_token=${token}`,
      );
      summarizeInsight(m, r);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function summarizeInsight(metricName: string, r: { status: number; body: unknown }) {
  if (r.status !== 200) {
    const err = (r.body as { error?: { message?: string; code?: number } })?.error;
    console.log(
      `  ❌ ${metricName.padEnd(35)} ${r.status}  ${err?.message?.slice(0, 100) ?? ""}`,
    );
    return;
  }
  const data = (r.body as { data?: Array<{ values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> })?.data ?? [];
  if (data.length === 0) {
    console.log(`  ⚠️  ${metricName.padEnd(35)} 200 but empty`);
    return;
  }
  // Try to summarize the value(s) — handles both time-series + total_value shape
  const first = data[0];
  let summary = "—";
  if (first.total_value !== undefined) {
    summary = `total_value=${JSON.stringify(first.total_value).slice(0, 80)}`;
  } else if (first.values && first.values.length > 0) {
    const vals = first.values.map((v) => v.value);
    const numeric = vals.filter((v) => typeof v === "number") as number[];
    if (numeric.length === vals.length) {
      const sum = numeric.reduce((a, b) => a + b, 0);
      summary = `n=${vals.length} sum=${sum}`;
    } else {
      summary = `values=${JSON.stringify(vals).slice(0, 80)}`;
    }
  }
  console.log(`  ✅ ${metricName.padEnd(35)} ${summary}`);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
