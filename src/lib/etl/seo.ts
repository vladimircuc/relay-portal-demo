/**
 * SEO daily pull — fills seo_daily_metrics / seo_top_* / seo_ga4_* for one
 * client from three sources, mirroring lib/etl/social.ts:
 *
 *   - Google Search Console  (clicks / impressions / avg position / keyword
 *     count + top queries + top pages)
 *   - GA4                     (sessions / users / conversions / engagement +
 *     channel mix + top landing pages)
 *   - Bing Webmaster          (clicks / impressions + top queries + pages)
 *
 * AUTH:
 *   - Google (GSC + GA4): one agency service account using **Domain-Wide
 *     Delegation** to impersonate a Workspace user (SEO_GOOGLE_SUBJECT,
 *     default kris@). The bot inherits that user's property access — this is
 *     the documented bypass for Google's bug that blocks adding new service
 *     accounts directly to GA4/GSC. Key in GOOGLE_SA_KEY_B64 (agency-wide).
 *   - Bing: single API key (BING_WEBMASTER_API_KEY), covers all verified sites.
 *
 * Per-client property identifiers come from client_seo_config; a client with
 * no config row (or no identifier for a source) is simply skipped. One
 * source failing never blocks the others — each returns an EtlBreakdownItem.
 *
 * Called via withEtlRun from the nightly cron + /api/etl/seo/[clientId]. NEVER
 * hit live from a page render.
 */
import { JWT } from "google-auth-library";
import { createAdminClient } from "@/lib/supabase/server";
import type { EtlPullResult, EtlBreakdownItem } from "./runs";
import { runLeadsPull } from "./seo-leads-etl";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
/** Workspace user the service account impersonates (DWD). Swappable without
 *  redoing the Workspace authorization — any domain user with property access. */
const GOOGLE_SUBJECT = process.env.SEO_GOOGLE_SUBJECT || "vladimircuc007@gmail.com";

// Window sizes (days). Daily series is pulled deep for the 12-month chart;
// the heavier date×query keyword count + the top-N snapshots use shorter windows.
const DAILY_DAYS = 490;    // ~16 months — GSC's full retention (the max it serves)
const KEYWORD_DAYS = 365;  // distinct-query-per-day count, trailing year
const TOP_DAYS = 28;       // top queries/pages snapshot window
const TOP_LIMIT = 1000;    // store up to N top rows (UI shows top ~100; the "Keywords" tile uses the full count)
const GSC_LAG = 3;         // GSC data settles ~2–3 days behind
const RECENT_DAYS = 30;    // nightly-cron refresh window — the backfill seeds full history; the cron only keeps recent days fresh (so it doesn't re-paginate a year of query data every night)

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

export function googleAuth(): JWT {
  const b64 = process.env.GOOGLE_SA_KEY_B64;
  if (!b64) throw new Error("GOOGLE_SA_KEY_B64 is not set");
  const sa = JSON.parse(Buffer.from(b64, "base64").toString());
  return new JWT({
    email: sa.client_email,
    key: sa.private_key,
    subject: GOOGLE_SUBJECT,
    scopes: [GSC_SCOPE, GA4_SCOPE],
  });
}

/** Delete the existing snapshot rows for a scope, then insert the fresh set. */
async function replaceRows(
  supabase: SupabaseAdmin,
  table: string,
  match: Record<string, string>,
  rows: Record<string, unknown>[],
): Promise<void> {
  let del = supabase.from(table).delete();
  for (const [k, v] of Object.entries(match)) del = del.eq(k, v);
  const { error: delErr } = await del;
  if (delErr) throw new Error(`${table} delete: ${delErr.message}`);
  if (rows.length) {
    const { error } = await supabase.from(table).insert(rows);
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
}

// ── Google Search Console ─────────────────────────────────────────────────
type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
async function gscQuery(auth: JWT, site: string, body: Record<string, unknown>): Promise<GscRow[]> {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const { data } = await auth.request<{ rows?: GscRow[] }>({ url, method: "POST", data: body });
  return data.rows ?? [];
}

/** Paginate a Search Analytics query through ALL matching rows. GSC caps each
 *  page at 25k (sorted by clicks desc); `startRow` walks the full set. Required
 *  for date×query over a long window — one page can't cover every (day, query)
 *  pair, and that cap is exactly what skewed the old keyword counts toward 0. */
async function gscQueryAll(auth: JWT, site: string, body: Record<string, unknown>): Promise<GscRow[]> {
  const PAGE = 25000;
  const all: GscRow[] = [];
  for (let startRow = 0; startRow < 5_000_000; startRow += PAGE) {
    const rows = await gscQuery(auth, site, { ...body, rowLimit: PAGE, startRow });
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/** PostgREST caps request size — insert large row sets in chunks. */
async function insertChunked(supabase: SupabaseAdmin, table: string, rows: Record<string, unknown>[], chunk = 4000): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + chunk));
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
}

/** Replace a day-window of per-day rows: delete [fromDay, toDay] (optionally
 *  scoped to a source) then chunk-insert the fresh set — so the cron's short
 *  window never wipes the backfill's deep history. */
async function replaceWindow(
  supabase: SupabaseAdmin, table: string, clientId: string,
  fromDay: string, toDay: string, rows: Record<string, unknown>[], source?: string,
): Promise<void> {
  let del = supabase.from(table).delete().eq("client_id", clientId).gte("day", fromDay).lte("day", toDay);
  if (source) del = del.eq("source", source);
  const { error } = await del;
  if (error) throw new Error(`${table} delete: ${error.message}`);
  await insertChunked(supabase, table, rows);
}

async function pullGsc(auth: JWT, site: string, clientId: string, supabase: SupabaseAdmin, full: boolean): Promise<number> {
  const endDate = ymd(daysAgo(GSC_LAG));
  // Backfill pulls full history; the nightly cron only refreshes the recent
  // window (older days are stable + already stored, so re-pulling a year of
  // query data every night would be wasteful and could null old keyword counts).
  const totalsStart = ymd(daysAgo(GSC_LAG + (full ? DAILY_DAYS : RECENT_DAYS)));
  const kwStart = ymd(daysAgo(GSC_LAG + (full ? KEYWORD_DAYS : RECENT_DAYS)));

  // Daily totals (date-only → one row per day, no row cap, always accurate).
  const daily = await gscQuery(auth, site, {
    startDate: totalsStart,
    endDate,
    dimensions: ["date"],
    rowLimit: 10000,
  });

  // FULL date×query export, PAGINATED so every (day, query) pair is captured —
  // not just the first 25k by clicks. Feeds (a) the accurate per-day distinct
  // count (seo_daily_metrics.keywords) and (b) the seo_query_daily presence rows
  // that let the read layer compute an EXACT distinct count for any date range.
  const kwRows = await gscQueryAll(auth, site, { startDate: kwStart, endDate, dimensions: ["date", "query"] });
  const kwByDay = new Map<string, Set<string>>();
  const presence = kwRows.map((r) => {
    const day = r.keys[0], query = r.keys[1];
    if (!kwByDay.has(day)) kwByDay.set(day, new Set());
    kwByDay.get(day)!.add(query);
    return { client_id: clientId, source: "google", day, query, clicks: r.clicks, impressions: r.impressions, position: +r.position.toFixed(2) };
  });
  await replaceWindow(supabase, "seo_query_daily", clientId, kwStart, endDate, presence, "google");

  // Per-day PAGE presence (parallels query presence, paginated) → range-flexible
  // Top pages that follow the date picker.
  const pageRows = await gscQueryAll(auth, site, { startDate: kwStart, endDate, dimensions: ["date", "page"] });
  const pagePresence = pageRows.map((r) => ({
    client_id: clientId, source: "google", day: r.keys[0], page: r.keys[1],
    clicks: r.clicks, impressions: r.impressions, position: +r.position.toFixed(2),
  }));
  await replaceWindow(supabase, "seo_page_daily", clientId, kwStart, endDate, pagePresence, "google");

  const dailyRows = daily.map((r) => ({
    client_id: clientId,
    source: "google",
    day: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    position: +r.position.toFixed(2),
    keywords: kwByDay.get(r.keys[0])?.size ?? null,
  }));
  if (dailyRows.length) {
    const { error } = await supabase.from("seo_daily_metrics").upsert(dailyRows, { onConflict: "client_id,source,day" });
    if (error) throw new Error(`seo_daily_metrics (google): ${error.message}`);
  }

  // Top queries + pages snapshot (recent window).
  const tq = await gscQuery(auth, site, { startDate: ymd(daysAgo(GSC_LAG + TOP_DAYS)), endDate, dimensions: ["query"], rowLimit: TOP_LIMIT });
  await replaceRows(supabase, "seo_top_queries", { client_id: clientId, source: "google" },
    tq.map((r) => ({ client_id: clientId, source: "google", query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: +(r.ctr * 100).toFixed(3), position: +r.position.toFixed(2) })));

  const tp = await gscQuery(auth, site, { startDate: ymd(daysAgo(GSC_LAG + TOP_DAYS)), endDate, dimensions: ["page"], rowLimit: TOP_LIMIT });
  await replaceRows(supabase, "seo_top_pages", { client_id: clientId, source: "google" },
    tp.map((r) => ({ client_id: clientId, source: "google", page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: +(r.ctr * 100).toFixed(3), position: +r.position.toFixed(2) })));

  return dailyRows.length + presence.length + pagePresence.length + tq.length + tp.length;
}

// ── GA4 Data API ────────────────────────────────────────────────────────────
type Ga4Row = { dimensionValues: { value: string }[]; metricValues: { value: string }[] };
async function ga4Report(auth: JWT, propertyId: string, body: Record<string, unknown>): Promise<Ga4Row[]> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const { data } = await auth.request<{ rows?: Ga4Row[] }>({ url, method: "POST", data: body });
  return data.rows ?? [];
}

async function pullGa4(auth: JWT, propertyId: string, clientId: string, supabase: SupabaseAdmin, full: boolean): Promise<number> {
  // Backfill = full history; cron = recent window only (cheap nightly refresh).
  const ga4Days = full ? DAILY_DAYS : RECENT_DAYS;
  const ga4Start = ymd(daysAgo(ga4Days));
  const ga4End = ymd(daysAgo(1)); // GA4 settles to "yesterday"

  // Daily site metrics.
  const daily = await ga4Report(auth, propertyId, {
    dateRanges: [{ startDate: `${ga4Days}daysAgo`, endDate: "yesterday" }],
    dimensions: [{ name: "date" }],
    // NOTE: screenPageViews is APPENDED last so the existing m[0..4] indices stay
    // stable. m[5] = real page views (distinct from conversions/key-events).
    metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "conversions" }, { name: "engagedSessions" }, { name: "userEngagementDuration" }, { name: "screenPageViews" }],
    limit: 100000,
  });
  const dailyRows = daily.map((r) => {
    const d = r.dimensionValues[0].value; // YYYYMMDD
    const m = r.metricValues.map((v) => Number(v.value));
    const sessions = m[0];
    return {
      client_id: clientId,
      day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      sessions,
      users: m[1],
      conversions: m[2],
      engaged_sessions: m[3],
      avg_engagement_sec: sessions ? +(m[4] / sessions).toFixed(2) : 0,
      page_views: m[5],
    };
  });
  if (dailyRows.length) {
    const { error } = await supabase.from("seo_ga4_daily").upsert(dailyRows, { onConflict: "client_id,day" });
    if (error) throw new Error(`seo_ga4_daily: ${error.message}`);
  }

  // Per-day channel mix → range-flexible traffic-source donut.
  const chDaily = await ga4Report(auth, propertyId, {
    dateRanges: [{ startDate: `${ga4Days}daysAgo`, endDate: "yesterday" }],
    dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }],
    limit: 100000,
  });
  const chDailyRows = chDaily.map((r) => {
    const d = r.dimensionValues[0].value;
    return { client_id: clientId, day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, channel: r.dimensionValues[1].value || "(other)", sessions: Number(r.metricValues[0].value), conversions: Number(r.metricValues[1].value) };
  });
  await replaceWindow(supabase, "seo_ga4_channel_daily", clientId, ga4Start, ga4End, chDailyRows);

  // Per-day landing pages → range-flexible Top landing pages.
  const lpDaily = await ga4Report(auth, propertyId, {
    dateRanges: [{ startDate: `${ga4Days}daysAgo`, endDate: "yesterday" }],
    dimensions: [{ name: "date" }, { name: "landingPage" }],
    metrics: [{ name: "sessions" }],
    limit: 100000,
  });
  const lpDailyRows = lpDaily.map((r) => {
    const d = r.dimensionValues[0].value;
    return { client_id: clientId, day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, page: r.dimensionValues[1].value || "(direct)", sessions: Number(r.metricValues[0].value) };
  });
  await replaceWindow(supabase, "seo_ga4_landing_daily", clientId, ga4Start, ga4End, lpDailyRows);

  // Channel mix (recent window).
  const ch = await ga4Report(auth, propertyId, {
    dateRanges: [{ startDate: `${TOP_DAYS}daysAgo`, endDate: "yesterday" }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "conversions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 25,
  });
  await replaceRows(supabase, "seo_ga4_channels", { client_id: clientId },
    ch.map((r) => ({ client_id: clientId, channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value), conversions: Number(r.metricValues[1].value) })));

  // Top landing pages (recent window).
  const lp = await ga4Report(auth, propertyId, {
    dateRanges: [{ startDate: `${TOP_DAYS}daysAgo`, endDate: "yesterday" }],
    dimensions: [{ name: "landingPage" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 15,
  });
  await replaceRows(supabase, "seo_ga4_landing_pages", { client_id: clientId },
    lp.map((r) => ({ client_id: clientId, page: r.dimensionValues[0].value || "(direct)", sessions: Number(r.metricValues[0].value) })));

  return dailyRows.length + chDailyRows.length + lpDailyRows.length + ch.length + lp.length;
}

/** Exact period-DISTINCT users for one or more date ranges in a single GA4
 *  report (multiple dateRanges → distinct totalUsers per range). Summing daily
 *  users over-counts repeat visitors, so the Users tile uses this instead. */
export async function fetchGa4PeriodUsers(propertyId: string, ranges: { start: string; end: string }[]): Promise<number[]> {
  const auth = googleAuth();
  const rows = await ga4Report(auth, propertyId, {
    dateRanges: ranges.map((r) => ({ startDate: r.start, endDate: r.end })),
    metrics: [{ name: "totalUsers" }],
    limit: 100,
  });
  const out = ranges.map(() => 0);
  for (const r of rows) {
    // With multiple dateRanges GA4 adds a "dateRange" dimension: date_range_0, …
    const dv = r.dimensionValues?.[0]?.value ?? "date_range_0";
    const idx = dv.startsWith("date_range_") ? Number(dv.slice(11)) : 0;
    if (idx >= 0 && idx < out.length) out[idx] = Number(r.metricValues[0].value) || 0;
  }
  return out;
}

// ── Bing Webmaster ────────────────────────────────────────────────────────
type BingRow = { Date?: string; Query?: string; Clicks?: number; Impressions?: number; AvgImpressionPosition?: number };
async function bingCall(method: string, site: string): Promise<BingRow[]> {
  const key = process.env.BING_WEBMASTER_API_KEY;
  if (!key) throw new Error("BING_WEBMASTER_API_KEY is not set");
  const url = `https://ssl.bing.com/webmaster/api.svc/json/${method}?apikey=${key}&siteUrl=${encodeURIComponent(site)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`Bing ${method} ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (json.d === undefined) throw new Error(`Bing ${method}: unexpected shape ${text.slice(0, 200)}`);
  return json.d ?? [];
}
/** Bing dates arrive as "/Date(1700000000000-0700)/". */
function bingDate(s: string | undefined): string | null {
  const m = s?.match(/\/Date\((\d+)/);
  return m ? ymd(new Date(Number(m[1]))) : null;
}
/** Bing query/page stats arrive per-date; collapse to one row per label. */
function aggregateBing(rows: BingRow[], field: "Query"): { label: string; clicks: number; impressions: number; position: number | null }[] {
  const m = new Map<string, { clicks: number; impressions: number; posSum: number; posN: number }>();
  for (const r of rows) {
    const label = r[field];
    if (label == null) continue;
    const e = m.get(label) ?? { clicks: 0, impressions: 0, posSum: 0, posN: 0 };
    e.clicks += r.Clicks ?? 0;
    e.impressions += r.Impressions ?? 0;
    if (r.AvgImpressionPosition != null) { e.posSum += r.AvgImpressionPosition; e.posN += 1; }
    m.set(label, e);
  }
  return [...m.entries()]
    .map(([label, e]) => ({ label, clicks: e.clicks, impressions: e.impressions, position: e.posN ? +(e.posSum / e.posN).toFixed(2) : null }))
    .sort((a, b) => b.impressions - a.impressions);
}

async function pullBing(site: string, clientId: string, supabase: SupabaseAdmin): Promise<number> {
  // Daily clicks/impressions.
  const rt = await bingCall("GetRankAndTrafficStats", site);
  const dailyRows = rt
    .map((r) => ({ client_id: clientId, source: "bing", day: bingDate(r.Date), clicks: r.Clicks ?? 0, impressions: r.Impressions ?? 0, position: null, keywords: null }))
    .filter((r) => r.day);
  if (dailyRows.length) {
    const { error } = await supabase.from("seo_daily_metrics").upsert(dailyRows, { onConflict: "client_id,source,day" });
    if (error) throw new Error(`seo_daily_metrics (bing): ${error.message}`);
  }

  // Top queries (aggregate per query).
  const qagg = aggregateBing(await bingCall("GetQueryStats", site), "Query");
  await replaceRows(supabase, "seo_top_queries", { client_id: clientId, source: "bing" },
    qagg.slice(0, TOP_LIMIT).map((a) => ({ client_id: clientId, source: "bing", query: a.label, clicks: a.clicks, impressions: a.impressions, ctr: a.impressions ? +((a.clicks / a.impressions) * 100).toFixed(3) : 0, position: a.position })));

  // Top pages (GetPageStats puts the URL in the Query field — quirk).
  const pagg = aggregateBing(await bingCall("GetPageStats", site), "Query");
  await replaceRows(supabase, "seo_top_pages", { client_id: clientId, source: "bing" },
    pagg.slice(0, TOP_LIMIT).map((a) => ({ client_id: clientId, source: "bing", page: a.label, clicks: a.clicks, impressions: a.impressions, ctr: a.impressions ? +((a.clicks / a.impressions) * 100).toFixed(3) : 0, position: a.position })));

  return dailyRows.length + qagg.length + pagg.length;
}

// ── Orchestrator ────────────────────────────────────────────────────────────
export async function runSeoDailyPull({ clientId, full = false }: { clientId: string; full?: boolean }): Promise<EtlPullResult> {
  const supabase = createAdminClient();
  const { data: cfg } = await supabase
    .from("client_seo_config")
    .select("gsc_site_url, ga4_property_id, bing_site_url, show_leads, lead_ghl_location_id, lead_ghl_token_secret_id, lead_pipeline_ids")
    .eq("client_id", clientId)
    .maybeSingle();

  // No config → client isn't wired for SEO; no-op cheaply (like socials does
  // for a client with zero connected platforms).
  if (!cfg) return { rowsWritten: 0, breakdown: [] };

  const breakdown: EtlBreakdownItem[] = [];
  let total = 0;
  const auth = cfg.gsc_site_url || cfg.ga4_property_id ? googleAuth() : null;

  if (cfg.gsc_site_url && auth) {
    try { const n = await pullGsc(auth, cfg.gsc_site_url, clientId, supabase, full); total += n; breakdown.push({ key: "google", ok: true, rows: n }); }
    catch (e) { breakdown.push({ key: "google", ok: false, rows: 0, error: msg(e) }); }
  }
  if (cfg.ga4_property_id && auth) {
    try { const n = await pullGa4(auth, cfg.ga4_property_id, clientId, supabase, full); total += n; breakdown.push({ key: "ga4", ok: true, rows: n }); }
    catch (e) { breakdown.push({ key: "ga4", ok: false, rows: 0, error: msg(e) }); }
  }
  if (cfg.bing_site_url) {
    try { const n = await pullBing(cfg.bing_site_url, clientId, supabase); total += n; breakdown.push({ key: "bing", ok: true, rows: n }); }
    catch (e) { breakdown.push({ key: "bing", ok: false, rows: 0, error: msg(e) }); }
  }
  // Website leads (opt-in): pull the configured GHL pipeline(s) → isolated
  // seo_lead_opportunities. Self-skips when show_leads is off (returns 0).
  if (cfg.show_leads) {
    try { const n = await runLeadsPull({ clientId, supabase, cfg }); total += n; breakdown.push({ key: "leads", ok: true, rows: n }); }
    catch (e) { breakdown.push({ key: "leads", ok: false, rows: 0, error: msg(e) }); }
  }

  return { rowsWritten: total, breakdown };
}
