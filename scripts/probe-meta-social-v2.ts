/**
 * Round 2 probe — investigate the metrics the first run flagged as
 * "needs metric_type=total_value" (profile_views, website_clicks, etc.)
 * and check media-level metrics across post types (photo / carousel /
 * reel) since the metric set differs by media_product_type.
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";

const G = `https://graph.facebook.com/v25.0`;

async function get(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as unknown }; }
  catch { return { status: res.status, body: text }; }
}

function summarize(name: string, r: { status: number; body: unknown }) {
  if (r.status !== 200) {
    const err = (r.body as { error?: { message?: string } })?.error?.message ?? "";
    console.log(`  ❌ ${name.padEnd(35)} ${r.status}  ${err.slice(0, 110)}`);
    return;
  }
  const data = (r.body as { data?: Array<{ values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }> })?.data ?? [];
  if (data.length === 0) { console.log(`  ⚠️  ${name.padEnd(35)} empty`); return; }
  const first = data[0];
  if (first.total_value !== undefined) {
    console.log(`  ✅ ${name.padEnd(35)} total=${JSON.stringify(first.total_value)}`);
  } else if (first.values) {
    const nums = first.values.map(v => v.value).filter(v => typeof v === "number") as number[];
    const sum = nums.reduce((a, b) => a + b, 0);
    console.log(`  ✅ ${name.padEnd(35)} n=${first.values.length} sum=${sum}`);
  } else {
    console.log(`  ✅ ${name.padEnd(35)} ${JSON.stringify(first).slice(0, 100)}`);
  }
}

async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error("usage: <slug>"); process.exit(1); }

  const supabase = createAdminClient();
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle();
  const { data: creds } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, fb_page_id, ig_user_id")
    .eq("client_id", (client as { id: string }).id).eq("platform", "meta").maybeSingle();
  const c = creds as { access_token_secret_id: string; fb_page_id: string; ig_user_id: string };
  const token = await getVaultSecret(supabase, c.access_token_secret_id);

  const until = Math.floor(Date.now() / 1000);
  const since = until - 28 * 86_400;

  console.log("\n━━━ IG — metrics that needed metric_type=total_value ━━━");
  const totalValueMetrics = [
    "profile_views",   // ← we want this one to work!
    "website_clicks",
    "follower_count",
    "phone_call_clicks",
    "text_message_clicks",
    "email_contacts",
    "get_directions_clicks",
  ];
  for (const m of totalValueMetrics) {
    const r = await get(
      `${G}/${c.ig_user_id}/insights?metric=${m}&period=day&since=${since}&until=${until}&metric_type=total_value&access_token=${token}`,
    );
    summarize(m, r);
  }

  console.log("\n━━━ IG — same metrics with breakdown=contact_button_type (where applicable) ━━━");
  const breakdownM = await get(
    `${G}/${c.ig_user_id}/insights?metric=profile_links_taps&period=day&since=${since}&until=${until}&metric_type=total_value&breakdown=contact_button_type&access_token=${token}`,
  );
  summarize("profile_links_taps[bk]", breakdownM);

  console.log("\n━━━ IG — lifetime audience metrics ━━━");
  const audienceMetrics = ["follower_demographics", "engaged_audience_demographics", "reached_audience_demographics"];
  for (const m of audienceMetrics) {
    const r = await get(
      `${G}/${c.ig_user_id}/insights?metric=${m}&period=lifetime&metric_type=total_value&breakdown=age,gender&access_token=${token}`,
    );
    summarize(m, r);
  }

  // Probe media-level insights across different post types to see which
  // metrics work for IMAGE / CAROUSEL_ALBUM / REELS / STORY
  console.log("\n━━━ IG — recent media (10) with product types ━━━");
  const mediaList = await get(
    `${G}/${c.ig_user_id}/media?fields=id,media_type,media_product_type,timestamp,caption&limit=10&access_token=${token}`,
  );
  const media = ((mediaList.body as { data?: Array<{ id: string; media_type: string; media_product_type: string; caption?: string }>; })?.data) ?? [];
  for (const m of media) {
    console.log(`  ${m.media_product_type.padEnd(8)} ${m.media_type.padEnd(8)} ${m.id}  "${(m.caption ?? "").slice(0, 50).replace(/\n/g, " ")}"`);
  }

  // Sample one of each product type if we can find them
  const sampleByType = new Map<string, { id: string; product: string }>();
  for (const m of media) {
    if (!sampleByType.has(m.media_product_type)) {
      sampleByType.set(m.media_product_type, { id: m.id, product: m.media_product_type });
    }
  }
  for (const [pt, sample] of sampleByType) {
    console.log(`\n━━━ IG — per-media insights for media_product_type=${pt} (${sample.id}) ━━━`);
    const metrics = [
      "reach", "views", "saved", "shares", "likes", "comments", "total_interactions",
      "follows", "profile_visits", "profile_activity",
      "ig_reels_avg_watch_time", "ig_reels_video_view_total_time",
    ];
    for (const metric of metrics) {
      const r = await get(`${G}/${sample.id}/insights?metric=${metric}&access_token=${token}`);
      summarize(metric, r);
    }
  }

  console.log("\n━━━ FB — additional Page insights to scope ━━━");
  const fbExtra = [
    "page_post_engagements",
    "page_impressions_organic_unique",
    "page_media_view",
    "page_media_viewer",        // unique viewers
    "page_views_total",
    "page_video_views",
    "page_actions_post_reactions_like_total",
  ];
  for (const m of fbExtra) {
    const r = await get(`${G}/${c.fb_page_id}/insights?metric=${m}&period=days_28&access_token=${token}`);
    summarize(m, r);
  }

  console.log("\n━━━ FB — follower deltas (fan adds/removes) the right way ━━━");
  // The doc shape changed — try both old + new field names
  const followerStuff = [
    "page_daily_follows_unique",
    "page_daily_unfollows_unique",
  ];
  for (const m of followerStuff) {
    const r = await get(`${G}/${c.fb_page_id}/insights?metric=${m}&period=days_28&access_token=${token}`);
    summarize(m, r);
  }
}

main().catch(e => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
