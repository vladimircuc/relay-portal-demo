// Seeds the Relay demo DB with a FULL YEAR of synthetic data across all three
// services (Ads, Socials, Web & SEO) for 3 clients + a super-admin demo login.
// Idempotent (truncates first). Run: node supabase/seed.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient as createSupabase } from "@supabase/supabase-js";

const dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(dir, "..", ".env.local"), "utf8")
    .split("\n").map((l) => l.match(/^([A-Z_]+)=(.+)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
);

const DEMO_EMAIL = "demo@relay.app";
const DEMO_PASSWORD = "relay-demo-2026";
const ADMIN_DOMAIN = "relay.app";
const YEAR = 365;

const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.round(rnd(a, b));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const r2 = (n) => Math.round(n * 100) / 100;
function dayStr(back) { const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() - back); return d.toISOString().slice(0, 10); }
function ts(back) { const d = new Date(); d.setUTCDate(d.getUTCDate() - back); d.setUTCHours(rint(8, 20), rint(0, 59), 0, 0); return d.toISOString(); }
const growth = (i, n, jitter = 0.04) => Math.min(1, Math.max(0, (n - i) / n + rnd(-jitter, jitter)));

// Box–Muller standard normal.
function gauss() { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }

// An INDEPENDENT daily-multiplier series (length n, chronological, index 0 = oldest),
// centered ~1. AR(1) mean-reverting random walk in log space + weekly seasonality +
// slow drift + rare spikes. Giving each metric its OWN {vol,weekly,phase,drift,spike}
// makes the curves look genuinely different (one spiky, one weekly-cyclical, one a
// steady climb, one noisy-flat) instead of one shape rescaled. Clamped to stay sane.
function trace(n, { vol = 0.13, revert = 0.12, weekly = 0.07, phase = 0, drift = 0, spike = 0 } = {}) {
  const out = new Array(n);
  let z = 0;
  for (let i = 0; i < n; i++) {
    z = z * (1 - revert) + gauss() * vol;
    let m = Math.exp(z + drift * (i / n) + weekly * Math.sin((2 * Math.PI * i) / 7 + phase));
    if (spike > 0 && Math.random() < spike) m *= rnd(1.5, 3.0);
    out[i] = Math.max(0.18, Math.min(4.5, m));
  }
  return out;
}

// One successful etl_runs row, "ran this morning around 5 AM" `backDays` ago.
function etlRun(cid, source, rows, backDays, durSec) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - backDays);
  start.setUTCHours(5, rint(0, 30), 0, 0);
  const fin = new Date(start.getTime() + durSec * 1000);
  return { client_id: cid, source, status: "success", rows_written: rows, started_at: start.toISOString(), finished_at: fin.toISOString() };
}

async function bulk(c, table, cols, rows) {
  for (let s = 0; s < rows.length; s += 500) {
    const slice = rows.slice(s, s + 500);
    const p = [];
    const tuples = slice.map((row) => `(${cols.map((col) => { p.push(row[col] === undefined ? null : row[col]); return `$${p.length}`; }).join(",")})`);
    await c.query(`insert into ${table} (${cols.join(",")}) values ${tuples.join(",")}`, p);
  }
}

const CLIENTS = [
  { slug: "brightside-dental", name: "Brightside Dental", accent: "#3aa0ff", book: "Booking", show: "Consult", revPerShow: 0, adBase: 150, site: "brightsidedental.com", handle: "brightsidedental" },
  { slug: "apex-law", name: "Apex Law Group", accent: "#c9a227", book: "Consult", show: "Signed", revPerShow: 0, adBase: 380, site: "apexlawgroup.com", handle: "apexlaw" },
  { slug: "pulse-fitness", name: "Pulse Fitness Co", accent: "#ff5d5d", book: "Trial", show: "Attended", revPerShow: 35, adBase: 95, site: "pulsefitnessco.com", handle: "pulsefitco" },
];

const STAGE_PICK = [...Array(42).fill("lead"), ...Array(8).fill("booked"), ...Array(8).fill("no_show"), ...Array(12).fill("showed"), ...Array(30).fill("won")];
const SOURCES = ["Meta - Lead Form", "Meta - Messenger", "Meta - Instagram"];
const FIRST = ["Jordan", "Casey", "Riley", "Avery", "Morgan", "Taylor", "Sam", "Jamie", "Alex", "Drew", "Quinn", "Reese", "Parker", "Skyler"];
const LAST = ["Carter", "Reed", "Bishop", "Flynn", "Hayes", "Park", "Nguyen", "Diaz", "Cole", "Frost", "Lang", "Webb", "Shaw", "Mercer"];

// social_daily_metrics / social_posts use these platform names, each scoped to an account_id.
const METRIC_PLATFORMS = [
  { p: "meta_instagram", base: 18000, eng: 0.06, key: "ig" },
  { p: "meta_facebook", base: 9000, eng: 0.02, key: "fb" },
  { p: "tiktok", base: 42000, eng: 0.09, key: "tt" },
  { p: "youtube", base: 6000, eng: 0.04, key: "yt" },
];
const GA4_CHANNELS = ["Organic Search", "Direct", "Paid Social", "Referral", "Organic Social", "Email"];
const GA4_SHARE = { "Organic Search": 0.42, "Direct": 0.2, "Paid Social": 0.15, "Referral": 0.1, "Organic Social": 0.09, "Email": 0.04 };

const TRUNCATE = [
  "clients", "meta_daily", "ghl_opportunities", "client_lifecycle_phases", "client_credentials",
  "etl_runs", "client_domains", "client_allowed_emails",
  "client_social_credentials", "social_daily_metrics", "social_posts", "client_seo_config",
  "seo_daily_metrics", "seo_ga4_daily", "seo_ga4_channel_daily", "seo_ga4_landing_daily",
  "seo_top_queries", "seo_top_pages", "seo_query_daily", "seo_page_daily",
  "seo_ai_daily", "seo_ai_grounding_queries", "seo_ai_cited_pages",
  "seo_local_grid", "seo_local_grid_competitors", "seo_local_grid_history",
];

const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
console.log("connected");
try {
  await client.query(`truncate ${TRUNCATE.join(", ")} restart identity cascade`);
  await client.query("truncate app_config");
  await client.query("truncate app_admin_emails");
  console.log("cleared");

  await bulk(client, "app_config", ["key", "value"], [{ key: "admin_domain", value: ADMIN_DOMAIN }]);
  await bulk(client, "app_admin_emails", ["email", "role"], [{ email: DEMO_EMAIL, role: "super_admin" }]);

  for (const cd of CLIENTS) {
    const id = randomUUID();
    await client.query(
      `insert into clients (id, slug, name, timezone, brand_accent_color, status, funnel_label_booking, funnel_label_show,
         revenue_per_show, enabled_services, ads_meta_source_only, goal_lead_to_booking, goal_show_rate, goal_show_to_conversion)
       values ($1,$2,$3,'America/Chicago',$4,'active',$5,$6,$7,$8::admin_capability[],true,0.55,0.78,0.45)`,
      [id, cd.slug, cd.name, cd.accent, cd.book, cd.show, cd.revPerShow, ["ads", "socials", "web", "seo"]],
    );
    await bulk(client, "client_lifecycle_phases", ["client_id", "phase_key", "display_label", "pipeline_stage_ids", "sort_order"], [
      { client_id: id, phase_key: "booked", display_label: cd.book, pipeline_stage_ids: ["booked", "no_show", "showed", "won"], sort_order: 1 },
      { client_id: id, phase_key: "no_show", display_label: "No-show", pipeline_stage_ids: ["no_show"], sort_order: 2 },
      { client_id: id, phase_key: "showed", display_label: cd.show, pipeline_stage_ids: ["showed", "won"], sort_order: 3 },
      { client_id: id, phase_key: "converted", display_label: "Converted", pipeline_stage_ids: ["won"], sort_order: 4 },
    ]);
    // Secret ids point at (fake) Vault entries — they make the Credentials
    // section read "Token set" without storing a real token. Nothing reads
    // these on render (the demo never calls a provider), so synthetic ids are
    // safe; the admin page's pipeline section is short-circuited in demo mode.
    await bulk(client, "client_credentials", ["client_id", "meta_ad_account_id", "meta_access_token_secret_id", "meta_result_type", "ghl_location_id", "ghl_token_secret_id", "ghl_pipeline_id"],
      [{ client_id: id, meta_ad_account_id: "act_" + rint(10000000, 99999999), meta_access_token_secret_id: randomUUID(), meta_result_type: "lead", ghl_location_id: "loc_" + cd.slug, ghl_token_secret_id: randomUUID(), ghl_pipeline_id: "demo-pipeline" }]);

    // ── ADS ──
    const meta = [];
    // Independent traces so the CTR / CPC / CPM sparklines wander like real
    // metrics (not flat white noise) and the underlying counts decorrelate.
    const adSpend = trace(YEAR, { vol: 0.14, weekly: 0.10, phase: 0.3, drift: 0.0, spike: 0.03 });
    const adCpm   = trace(YEAR, { vol: 0.10, weekly: 0.08, phase: 2.0, drift: 0.12 });  // CPM creeps up (auction inflation)
    const adCtr   = trace(YEAR, { vol: 0.12, weekly: 0.14, phase: 4.0, drift: -0.10 }); // CTR slowly fatigues, weekly rhythm
    const adRrate = trace(YEAR, { vol: 0.16, weekly: 0.06, phase: 5.2, drift: 0.0 });   // result-rate wander
    const adReach = trace(YEAR, { vol: 0.08, weekly: 0.05, phase: 1.1, drift: 0.0 });
    for (let i = YEAR - 1; i >= 0; i--) {
      const c = YEAR - 1 - i;
      const g = 0.7 + 0.3 * growth(i, YEAR, 0);
      const spend = r2(cd.adBase * g * adSpend[c]);
      const cpm = r2(Math.max(6, 16 * adCpm[c]));
      const impressions = Math.round((spend / cpm) * 1000);
      const ctr = Math.max(0.004, 0.02 * adCtr[c]);
      const link_clicks = Math.max(1, Math.round(impressions * ctr));
      const reach = Math.round(impressions * Math.min(0.92, 0.66 * adReach[c]));
      const results = Math.max(1, Math.round(link_clicks * Math.min(0.2, 0.08 * adRrate[c])));
      meta.push({ client_id: id, day: dayStr(i), spend, impressions, reach, frequency: r2(impressions / Math.max(reach, 1)), link_clicks, cpm, cpc: r2(spend / Math.max(link_clicks, 1)), ctr: r2(ctr * 100), results, cost_per_result: r2(spend / results) });
    }
    await bulk(client, "meta_daily", ["client_id", "day", "spend", "impressions", "reach", "frequency", "link_clicks", "cpm", "cpc", "ctr", "results", "cost_per_result"], meta);

    const opps = [];
    for (let k = 0; k < rint(620, 880); k++) {
      const stage = pick(STAGE_PICK);
      const won = stage === "won";
      opps.push({ client_id: id, ghl_id: "ghl_" + randomUUID().slice(0, 12), created_at_ghl: ts(rint(0, YEAR - 1)), opportunity_name: `${pick(FIRST)} ${pick(LAST)}`, contact_name: `${pick(FIRST)} ${pick(LAST)}`, contact_phone: `(555) ${rint(200, 999)}-${rint(1000, 9999)}`, contact_email: `lead${k}@example.com`, monetary_value: won ? rint(800, 4200) : 0, source: pick(SOURCES), status: won ? "won" : pick(["open", "open", "lost"]), pipeline_stage_id: stage, pipeline_id: "demo-pipeline" });
    }
    await bulk(client, "ghl_opportunities", ["client_id", "ghl_id", "created_at_ghl", "opportunity_name", "contact_name", "contact_phone", "contact_email", "monetary_value", "source", "status", "pipeline_stage_id", "pipeline_id"], opps);

    // ── SOCIALS ──
    // Credentials: one 'meta' row carrying both FB + IG ids, plus tiktok/youtube/linkedin.
    const acct = { ig: `${cd.slug}-ig`, fb: `${cd.slug}-fb`, tt: `${cd.slug}-tt`, yt: `${cd.slug}-yt` };
    // Usernames are stored WITHOUT a leading "@" — the UI prepends it on render
    // (storing "@handle" would double it to "@@handle"). YouTube handles keep
    // their "@" since that component strips a leading "@" before re-adding one.
    const credRows = [
      { platform: "meta", fb_page_id: acct.fb, fb_page_name: cd.name, ig_user_id: acct.ig, ig_username: cd.handle },
      { platform: "tiktok", tiktok_open_id: acct.tt, tiktok_username: cd.handle, tiktok_display_name: cd.name },
      { platform: "youtube", youtube_channel_id: acct.yt, youtube_channel_title: cd.name, youtube_channel_handle: "@" + cd.handle },
      { platform: "linkedin", linkedin_org_urn: "urn:li:organization:" + rint(1000000, 9999999), linkedin_org_name: cd.name, linkedin_vanity_name: cd.handle },
    ];
    for (const cr of credRows) await bulk(client, "client_social_credentials", ["client_id", ...Object.keys(cr)], [{ client_id: id, ...cr }]);

    const sdm = [], posts = [];
    for (const pf of METRIC_PLATFORMS) {
      const a = acct[pf.key];
      // Every plotted metric gets its OWN independent daily trajectory (distinct
      // volatility, weekly rhythm, phase, and trend) so toggling the chart shows
      // a genuinely different curve — not one reach curve rescaled. Magnitudes
      // still ride the followers level, so the metrics stay realistically ordered.
      const tGain  = trace(YEAR, { vol: 0.24, weekly: 0.05, phase: 0.6, drift: 0.10, spike: 0.05 }); // new follows: bursty
      const tImpr  = trace(YEAR, { vol: 0.16, weekly: 0.10, phase: 0.0, drift: 0.18, spike: 0.04 }); // impressions: spiky, climbing
      const tEng   = trace(YEAR, { vol: 0.11, weekly: 0.20, phase: 1.6, drift: -0.08 });             // engagement: weekly-cyclical
      const tPv    = trace(YEAR, { vol: 0.09, weekly: 0.07, phase: 3.0, drift: 0.45 });              // profile visits: steady climb
      const tLc    = trace(YEAR, { vol: 0.22, weekly: 0.05, phase: 4.7, drift: -0.15, revert: 0.28 }); // link clicks: noisy-flat
      const tReach = trace(YEAR, { vol: 0.10, weekly: 0.08, phase: 2.2, drift: 0.05 });
      const tWt    = trace(YEAR, { vol: 0.15, weekly: 0.12, phase: 5.5, drift: 0.20 });              // watch time (YouTube)
      const dailyGain = (pf.base * 0.38) / YEAR;
      let followers = Math.round(pf.base * 0.62);
      for (let i = YEAR - 1; i >= 0; i--) {
        const c = YEAR - 1 - i; // chronological index (0 = oldest)
        const gained = Math.max(0, Math.round(dailyGain * tGain[c]));
        followers += gained;
        const impressions = Math.max(1, Math.round(followers * 0.46 * tImpr[c]));
        const reach = Math.min(impressions, Math.max(1, Math.round(followers * 0.34 * tReach[c])));
        const engagements = Math.max(0, Math.round(followers * 0.46 * pf.eng * tEng[c]));
        const profile_visits = Math.max(0, Math.round(followers * 0.018 * tPv[c]));
        const link_clicks = Math.max(0, Math.round(followers * 0.0045 * tLc[c]));
        const shares = Math.max(0, Math.round(engagements * 0.06 * rnd(0.7, 1.3)));
        sdm.push({ client_id: id, platform: pf.p, account_id: a, day: dayStr(i), source: "backfill", followers, followers_delta: gained, follows_gained: gained, impressions, reach, engagements, profile_visits, link_clicks, posts_count: Math.random() < 0.4 ? 1 : 0, shares, watch_time_minutes: pf.p === "youtube" ? Math.max(1, Math.round(followers * 0.5 * tWt[c])) : null });
      }
      const captions = ["Behind the scenes this week", "Client results that speak for themselves", "Meet the team", "5 things you should know", "New this month", "Quick tip Tuesday"];
      const nPosts = pf.p === "meta_instagram" || pf.p === "tiktok" ? 5 : 2;
      for (let j = 0; j < nPosts; j++) {
        const reach = rint(pf.base * 0.2, pf.base * 1.6);
        const engagements = Math.round(reach * pf.eng * rnd(0.8, 2.2));
        posts.push({ client_id: id, platform: pf.p, account_id: a, post_id: `${pf.p}_${randomUUID().slice(0, 10)}`, posted_at: ts(rint(0, 90)), permalink: `https://example.com/${pf.p}/${j}`, caption: pick(captions), media_type: pick(["image", "video", "carousel"]), reach_kind: null, reach, engagements, likes: Math.round(engagements * 0.8), comments: Math.round(engagements * 0.08), shares: Math.round(engagements * 0.07), saves: Math.round(engagements * 0.05), source: "backfill" });
      }
    }
    await bulk(client, "social_daily_metrics", ["client_id", "platform", "account_id", "day", "source", "followers", "followers_delta", "follows_gained", "impressions", "reach", "engagements", "profile_visits", "link_clicks", "posts_count", "shares", "watch_time_minutes"], sdm);
    await bulk(client, "social_posts", ["client_id", "platform", "account_id", "post_id", "posted_at", "permalink", "caption", "media_type", "reach_kind", "reach", "engagements", "likes", "comments", "shares", "saves", "source"], posts);

    // ── ADMIN: ETL run history (so the ETL Status section reads "Success") ──
    await bulk(client, "etl_runs", ["client_id", "source", "status", "rows_written", "started_at", "finished_at"], [
      etlRun(id, "meta_backfill", meta.length, 0, 42),
      etlRun(id, "meta_daily", rint(1, 3), 0, 6),
      etlRun(id, "ghl_full", opps.length, 0, 18),
      etlRun(id, "social_daily", sdm.length, 0, 25),
    ]);

    // ── ADMIN: Access lists (a domain + a viewer + a scoped local super-admin) ──
    await client.query(`insert into client_domains (client_id, email_domain) values ($1,$2)`, [id, cd.site]);
    await client.query(
      `insert into client_allowed_emails (client_id, email, note, role, scopes) values
         ($1,$2,$3,'viewer',null),
         ($1,$4,$5,'local_super_admin',$6::admin_capability[])`,
      [id, `owner@${cd.site}`, "Client owner — full dashboard view", `manager@${cd.site}`, "Marketing manager — manages Ads + Socials", ["ads", "socials"]],
    );

    // ── WEB & SEO ──
    const reportId = rint(100000, 999999);
    await bulk(client, "client_seo_config", ["client_id", "gsc_site_url", "ga4_property_id", "bing_site_url", "brightlocal_report_id"],
      [{ client_id: id, gsc_site_url: `https://${cd.site}/`, ga4_property_id: "properties/" + rint(100000000, 999999999), bing_site_url: `https://${cd.site}/`, brightlocal_report_id: reportId }]);

    const seoDaily = [], gaDaily = [], chDaily = [], landDaily = [], qDaily = [], pDaily = [];
    const QUERIES = [`${cd.handle} near me`, `best ${cd.name.split(" ")[0].toLowerCase()}`, `${cd.handle} reviews`, `${cd.handle} pricing`, `${cd.handle} hours`, `${cd.handle} appointment`, `affordable ${cd.handle}`, `${cd.handle} services`, `top rated ${cd.handle}`, `${cd.handle} consultation`, `${cd.handle} phone number`, `${cd.handle} location`];
    const PAGES = ["/", "/services", "/about", "/contact", "/pricing", "/book", "/reviews", "/blog"];
    // Independent traces — clicks, impressions, keywords, sessions and position
    // each move on their own (so toggling clicks↔impressions shows different
    // curves), while all riding the same slow SEO growth ramp `g`.
    const tClk  = trace(YEAR, { vol: 0.16, weekly: 0.12, phase: 0.0, drift: 0.10 });
    const tImp  = trace(YEAR, { vol: 0.13, weekly: 0.08, phase: 2.3, drift: 0.25 });
    const tKw   = trace(YEAR, { vol: 0.07, weekly: 0.03, phase: 4.0, drift: 0.50 });
    const tPos  = trace(YEAR, { vol: 0.10, weekly: 0.05, phase: 1.3, drift: 0.0 });
    const tSess = trace(YEAR, { vol: 0.15, weekly: 0.14, phase: 5.0, drift: 0.12 });
    for (let i = YEAR - 1; i >= 0; i--) {
      const c = YEAR - 1 - i;
      const g = 0.55 + 0.45 * growth(i, YEAR, 0.02);
      const clicks = Math.max(1, Math.round(220 * g * tClk[c]));
      const impressions = Math.max(clicks, Math.round(5200 * g * tImp[c]));
      seoDaily.push({ client_id: id, source: "google", day: dayStr(i), clicks, impressions, position: r2(Math.max(1.3, 7.8 - 3.2 * g + 2.0 * (tPos[c] - 1))), keywords: Math.round(190 * g * tKw[c]) });
      const sessions = Math.max(1, Math.round(360 * g * tSess[c]));
      gaDaily.push({ client_id: id, day: dayStr(i), sessions, users: Math.round(sessions * rnd(0.7, 0.85)), conversions: Math.round(sessions * rnd(0.02, 0.06)), engaged_sessions: Math.round(sessions * rnd(0.55, 0.72)), avg_engagement_sec: r2(rnd(45, 140)), page_views: Math.round(sessions * rnd(1.8, 3.2)) });
      if (i < 120) {
        for (const ch of GA4_CHANNELS) { const s = Math.round(sessions * GA4_SHARE[ch] * rnd(0.7, 1.3)); chDaily.push({ client_id: id, day: dayStr(i), channel: ch, sessions: s, conversions: Math.round(s * rnd(0.02, 0.05)) }); }
        for (const pg2 of PAGES.slice(0, 6)) landDaily.push({ client_id: id, day: dayStr(i), page: pg2, sessions: Math.round(sessions * rnd(0.05, 0.3)) });
        for (const q of QUERIES.slice(0, 10)) { const qc = rint(0, 12); qDaily.push({ client_id: id, source: "google", day: dayStr(i), query: q, clicks: qc, impressions: qc * rint(12, 30) + rint(5, 40), position: r2(rnd(2, 18)) }); }
        for (const p2 of PAGES) { const pc = rint(0, 18); pDaily.push({ client_id: id, source: "google", day: dayStr(i), page: p2, clicks: pc, impressions: pc * rint(12, 30) + rint(5, 50), position: r2(rnd(2, 16)) }); }
      }
    }
    await bulk(client, "seo_daily_metrics", ["client_id", "source", "day", "clicks", "impressions", "position", "keywords"], seoDaily);
    await bulk(client, "seo_ga4_daily", ["client_id", "day", "sessions", "users", "conversions", "engaged_sessions", "avg_engagement_sec", "page_views"], gaDaily);
    await bulk(client, "seo_ga4_channel_daily", ["client_id", "day", "channel", "sessions", "conversions"], chDaily);
    await bulk(client, "seo_ga4_landing_daily", ["client_id", "day", "page", "sessions"], landDaily);
    await bulk(client, "seo_query_daily", ["client_id", "source", "day", "query", "clicks", "impressions", "position"], qDaily);
    await bulk(client, "seo_page_daily", ["client_id", "source", "day", "page", "clicks", "impressions", "position"], pDaily);

    // AI Performance — LLM citation history (last ~100 days, trending up) so the
    // "AI Citations" tile + AI section render with real data instead of zero.
    const aiDaily = [];
    for (let i = 99; i >= 0; i--) {
      const g = 0.4 + 0.6 * growth(i, 100, 0.05);
      aiDaily.push({ client_id: id, day: dayStr(i), citations: Math.max(0, Math.round(rnd(3, 16) * g)), cited_pages: Math.max(1, Math.round(rnd(1, 5) * g)) });
    }
    await bulk(client, "seo_ai_daily", ["client_id", "day", "citations", "cited_pages"], aiDaily);
    await bulk(client, "seo_ai_grounding_queries", ["client_id", "query", "citations"], QUERIES.slice(0, 6).map((q) => ({ client_id: id, query: q, citations: rint(8, 90) })));
    await bulk(client, "seo_ai_cited_pages", ["client_id", "page", "citations"], PAGES.slice(0, 5).map((p2) => ({ client_id: id, page: p2, citations: rint(6, 70) })));

    const topQ = QUERIES.map((q) => { const cl = rint(40, 600); const im = cl * rint(14, 28); return { client_id: id, source: "google", query: q, clicks: cl, impressions: im, ctr: r2(cl / im), position: r2(rnd(1.5, 14)) }; });
    const topP = PAGES.map((p2) => { const cl = rint(60, 900); const im = cl * rint(14, 26); return { client_id: id, source: "google", page: p2, clicks: cl, impressions: im, ctr: r2(cl / im), position: r2(rnd(1.5, 12)) }; });
    await bulk(client, "seo_top_queries", ["client_id", "source", "query", "clicks", "impressions", "ctr", "position"], topQ);
    await bulk(client, "seo_top_pages", ["client_id", "source", "page", "clicks", "impressions", "ctr", "position"], topP);

    // ── LOCAL GRID heatmap ──
    const keywordId = rint(1000, 9999);
    const runId = rint(10000, 99999);
    const clat = 38.63 + rnd(-3, 3), clng = -90.2 + rnd(-3, 3);
    const points = [];
    let high = 0, med = 0, low = 0, rankSum = 0;
    for (let gx = 0; gx < 5; gx++) for (let gy = 0; gy < 5; gy++) {
      const rank = Math.max(1, Math.round(rnd(1, 20) - (4 - Math.abs(gx - 2) - Math.abs(gy - 2))));
      rankSum += rank; if (rank <= 3) high++; else if (rank <= 10) med++; else low++;
      points.push({ lat: r2(clat + (gx - 2) * 0.02), lng: r2(clng + (gy - 2) * 0.02), rank });
    }
    await bulk(client, "seo_local_grid", ["client_id", "report_id", "keyword_id", "keyword", "run_id", "run_date", "avg_rank", "num_points", "num_high", "num_med", "num_low", "grid_size", "grid_spacing", "center_lat", "center_lng", "business_lat", "business_lng", "business_name", "points"],
      [{ client_id: id, report_id: reportId, keyword_id: keywordId, keyword: QUERIES[0], run_id: runId, run_date: dayStr(2), avg_rank: r2(rankSum / 25), num_points: 25, num_high: high, num_med: med, num_low: low, grid_size: "5x5", grid_spacing: "2mi", center_lat: r2(clat), center_lng: r2(clng), business_lat: r2(clat), business_lng: r2(clng), business_name: cd.name, points: JSON.stringify(points) }]);
    await bulk(client, "seo_local_grid_competitors", ["client_id", "keyword_id", "rank", "title", "avg_rank", "authority", "links", "num_reviews", "review_rating", "primary_category", "is_client"],
      [1, 2, 3, 4, 5].map((rk) => ({ client_id: id, keyword_id: keywordId, rank: rk, title: rk === 2 ? cd.name : `${pick(["Premier", "Elite", "City", "Summit", "Metro"])} ${pick(["Group", "Co", "Partners", "Studio"])}`, avg_rank: r2(rk + rnd(-0.5, 1.5)), authority: rint(20, 70), links: rint(50, 800), num_reviews: rint(20, 400), review_rating: r2(rnd(3.8, 5)), primary_category: cd.name.split(" ").pop(), is_client: rk === 2 })));
    await bulk(client, "seo_local_grid_history", ["client_id", "keyword_id", "run_id", "run_date", "avg_rank"],
      [60, 30, 14, 2].map((b, idx) => ({ client_id: id, keyword_id: keywordId, run_id: runId - (4 - idx), run_date: dayStr(b), avg_rank: r2(rnd(6, 12) - idx * 1.2) })));

    console.log(`seeded ${cd.name}: ads ${meta.length}d/${opps.length}opps, social ${sdm.length}rows/${posts.length}posts, seo ${seoDaily.length}d + grid`);
  }

  const chk = await client.query(`select sum(spend)::int spend, sum(revenue)::int revenue, sum(leads)::int leads, sum(conversions)::int conversions from daily_metrics_v where client_id=(select id from clients order by name limit 1)`);
  console.log("ads view check (1yr):", chk.rows[0]);
} finally { await client.end(); }

const supa = createSupabase(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: list } = await supa.auth.admin.listUsers();
const ex = list?.users?.find((u) => u.email === DEMO_EMAIL);
if (ex) await supa.auth.admin.deleteUser(ex.id);
const { error } = await supa.auth.admin.createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true });
console.log(error ? `auth error: ${error.message}` : `auth user ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
console.log("done");
