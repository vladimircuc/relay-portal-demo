/**
 * SEO read layer — assembles the /seo dashboard payload (the SeoMock shape the
 * UI already renders) from Postgres: seo_daily_metrics / seo_top_* / seo_ga4_*
 * / seo_ai_*. Read via the service-role admin client (same as the ETL writes);
 * never hits a vendor API. Mirrors lib/socials-timeseries.ts.
 *
 * Period model: the search tiles + trend chart and the GA4 tiles follow the
 * SELECTED date range (these come from per-day tables, so any window works);
 * deltas compare against the equal-length window immediately before it. The
 * top-N tables (queries / pages), GA4 channel + landing breakdowns, and the AI
 * citations are CSV-fed aggregates (the whole upload, not period-sliceable).
 * Everything else — the search tables + GA4 channel/landing breakdowns — now
 * FOLLOWS the picker, aggregated over the exact range from the per-day tables
 * (seo_query_daily / seo_page_daily / seo_ga4_*_daily) via SQL functions, and
 * GA4 "Users" is the exact period-distinct count (not a sum of daily). The
 * 12-month chart stays a fixed trailing-365-day overview.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { fetchGa4PeriodUsers } from "@/lib/etl/seo";
import type {
  SeoMock, SeoSource, SourceData, SourceTotals, SourceDeltas, DailyPoint,
  QueryRow, PageRow, Ga4Data, AiData, LocalGrid, LocalGridPoint, LocalGridHistoryPoint,
} from "./seo-mock";

const PERIOD_DAYS = 28;
const YEAR_DAYS = 365;

/** The resolved window the range-flexible parts compute over: the selected
 *  [start,end], the comparison [compStart,compEnd], plus maxDay (the freshest
 *  stored day, used for the fixed trailing-year chart). */
type Window = { start: string; end: string; compStart: string; compEnd: string; maxDay: string };
/** What the page passes in after resolving the cookie/preset (maxDay is added
 *  internally from the stored data). */
export type SeoRange = { start: string; end: string; compStart: string; compEnd: string };

function addDaysIso(isoStr: string, n: number): string {
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Whole-day difference b − a (both yyyy-MM-dd), in UTC days. */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

// Search Console's freshest couple of days are still being revised, so the
// "Keywords" tile reports a POINT-IN-TIME count for the latest COMPLETE day
// (freshest stored day minus this tail), never past the picker's end. Keep in
// sync with SETTLING_DAYS in components/seo/seo-dashboard.tsx.
const SETTLING_DAYS = 2;
function fmtMonthDay(isoStr: string): string {
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtRange(a: string, b: string): string {
  return `${fmtMonthDay(a)} – ${fmtMonthDay(b)}, ${b.slice(0, 4)}`;
}
/** Period-over-period % change. Returns null when the prior value is 0 — a
 *  change "from zero" has no meaningful percentage (it's undefined, not +100%),
 *  so the UI shows no badge rather than a fabricated number. Callers additionally
 *  gate on whether a FULL prior period exists (see `hasFullComp`). */
function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return +(((cur - prev) / prev) * 100).toFixed(1);
}

/** The comparison window is only valid when the WHOLE prior period sits inside
 *  the source's stored data range — i.e. its start is on/after the earliest
 *  stored day. Otherwise the prior period is missing (range reaches data start)
 *  or only partially covered (which would inflate the %), so deltas are null. */
function hasFullComparison(sourceDays: string[], compStart: string): boolean {
  if (sourceDays.length === 0) return false;
  let min = sourceDays[0];
  for (const d of sourceDays) if (d < min) min = d;
  return compStart >= min;
}

type DailyRow = { source: string; day: string; clicks: number | null; impressions: number | null; position: number | null; keywords: number | null };
type TopQ = { source: string; query: string; clicks: number; impressions: number; ctr: number; position: number | null };
type TopP = { source: string; page: string; clicks: number; impressions: number; ctr: number; position: number | null };
type GaDaily = { day: string; sessions: number | null; users: number | null; conversions: number | null; engaged_sessions: number | null; avg_engagement_sec: number | null; page_views: number | null };

const sum = <T,>(arr: T[], k: (r: T) => number | null) => arr.reduce((a, r) => a + (k(r) ?? 0), 0);
const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);

function buildSource(
  source: SeoSource, daily: DailyRow[], topQ: TopQ[], topP: TopP[], win: Window,
  kw?: { latest: number; prevDay: number },
  ranged?: { queries?: QueryRow[]; pages?: PageRow[] },
): SourceData {
  const rows = daily.filter((r) => r.source === source);
  const yStart = addDaysIso(win.maxDay, -(YEAR_DAYS - 1));
  const between = (d: string, a: string, b: string) => d >= a && d <= b;

  const period = rows.filter((r) => between(r.day, win.start, win.end));
  const prev = rows.filter((r) => between(r.day, win.compStart, win.compEnd));
  const yearRows = rows.filter((r) => between(r.day, yStart, win.maxDay));

  const tq = topQ.filter((r) => r.source === source).sort((a, b) => b.impressions - a.impressions);
  const tp = topP.filter((r) => r.source === source).sort((a, b) => b.impressions - a.impressions);

  // Impression-WEIGHTED average position — the exact GSC period figure. A plain
  // mean of daily positions would weight a 5-impression day the same as a
  // 5,000-impression day; weighting by impressions reconstructs GSC's
  // per-impression average exactly: Σ(position×impressions) / Σ(impressions).
  const posAvg = (arr: DailyRow[]) => {
    const r = arr.filter((x) => x.position != null && (x.impressions ?? 0) > 0);
    const impr = r.reduce((a, x) => a + (x.impressions ?? 0), 0);
    if (!impr) return 0;
    return +(r.reduce((a, x) => a + (x.position as number) * (x.impressions ?? 0), 0) / impr).toFixed(1);
  };
  const totalsFor = (arr: DailyRow[], keywords: number): SourceTotals => {
    const clicks = sum(arr, (r) => r.clicks);
    const impressions = sum(arr, (r) => r.impressions);
    return { clicks, impressions, keywords, ctr: impressions ? +((clicks / impressions) * 100).toFixed(1) : 0, position: posAvg(arr) };
  };

  // Keywords is a POINT-IN-TIME count — how many distinct terms you rank for on
  // the latest COMPLETE day (kw.latest, computed in loadSeoData). The same value
  // feeds BOTH the period and 12-month tiles: a "distinct over a range" total
  // isn't a meaningful single number, and the count is current either way. Falls
  // back to the top-queries snapshot count until seo_query_daily is populated.
  const kwLatest = kw && kw.latest > 0 ? kw.latest : tq.length;

  const totals = totalsFor(period, kwLatest);
  const prevTotals = totalsFor(prev, 0); // keywords field unused here (its delta is absolute, below)
  const yearTotals = totalsFor(yearRows, kwLatest);

  // Only surface deltas when a full prior period exists in THIS source's data.
  // On "All time" (or any range reaching the first stored day) the comparison
  // window precedes the data → no % badges instead of a bogus +100%.
  const fullComp = hasFullComparison(rows.map((r) => r.day), win.compStart);
  const deltas: SourceDeltas = fullComp ? {
    clicks: pctChange(totals.clicks, prevTotals.clicks),
    impressions: pctChange(totals.impressions, prevTotals.impressions),
    // Keywords delta is an ABSOLUTE count: the latest complete day vs the matching
    // day in the comparison period. null when either day has no keyword data.
    keywords: kw && kw.latest > 0 && kw.prevDay > 0 ? kw.latest - kw.prevDay : null,
    ctr: pctChange(totals.ctr, prevTotals.ctr),
    position: totals.position && prevTotals.position ? pctChange(totals.position, prevTotals.position) : null,
  } : { clicks: null, impressions: null, keywords: null, ctr: null, position: null };

  const toPoint = (r: DailyRow): DailyPoint => ({
    day: r.day, clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, keywords: r.keywords ?? 0, position: r.position ?? 0,
  });
  const qrow = (r: TopQ): QueryRow => ({ query: r.query, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position ?? 0 });
  const prow = (r: TopP): PageRow => ({ page: r.page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position ?? 0 });

  return {
    totals,
    deltas,
    series: period.map(toPoint),
    yearSeries: yearRows.map(toPoint),
    yearTotals,
    yearDeltas: { clicks: null, impressions: null, keywords: null, ctr: null, position: null }, // no prior-year window
    // Ranged top-N (follows the picker) when available; else the snapshot.
    topQueries: ranged?.queries?.length ? ranged.queries : tq.slice(0, 100).map(qrow),
    topPages: ranged?.pages?.length ? ranged.pages : tp.slice(0, 100).map(prow),
  };
}

function buildGa4(ga: GaDaily[], channels: { channel: string; sessions: number; conversions: number }[], landing: { page: string; sessions: number }[], win: Window, ranged?: { channels?: { name: string; sessions: number }[]; landing?: { page: string; sessions: number }[]; users?: { period: number; prev: number } }): Ga4Data {
  const between = (d: string, a: string, b: string) => d >= a && d <= b;
  const period = ga.filter((r) => between(r.day, win.start, win.end));
  const prev = ga.filter((r) => between(r.day, win.compStart, win.compEnd));

  const totalsFor = (arr: GaDaily[]) => {
    const sessions = sum(arr, (r) => r.sessions);
    const engaged = sum(arr, (r) => r.engaged_sessions);
    return {
      sessions,
      users: sum(arr, (r) => r.users), // NOTE: sum of daily users slightly over-counts vs GA4 period-distinct (v1)
      pageViews: sum(arr, (r) => r.page_views),
      conversions: sum(arr, (r) => r.conversions),
      engagementRate: sessions ? +((engaged / sessions) * 100).toFixed(1) : 0,
      avgEngagementSec: +avg(arr.filter((r) => r.avg_engagement_sec != null).map((r) => r.avg_engagement_sec as number)).toFixed(0),
    };
  };
  const totals = totalsFor(period);
  const pv = totalsFor(prev);
  // Exact period-distinct users when available (a sum of daily users over-counts
  // repeat visitors); else fall back to the daily sum.
  const usersPeriod = ranged?.users ? ranged.users.period : totals.users;
  const usersPrev = ranged?.users ? ranged.users.prev : pv.users;
  // No full prior period in the stored GA4 data → no % badges (null), not a
  // forced 0 or a +100% off an empty comparison window.
  const fullComp = hasFullComparison(ga.map((r) => r.day), win.compStart);
  return {
    totals: { ...totals, users: usersPeriod },
    deltas: fullComp ? {
      sessions: pctChange(totals.sessions, pv.sessions),
      users: pctChange(usersPeriod, usersPrev),
      pageViews: pctChange(totals.pageViews, pv.pageViews),
      conversions: pctChange(totals.conversions, pv.conversions),
      engagementRate: pctChange(totals.engagementRate, pv.engagementRate),
    } : { sessions: null, users: null, pageViews: null, conversions: null, engagementRate: null },
    channels: ranged?.channels?.length ? ranged.channels : channels.sort((a, b) => b.sessions - a.sessions).map((c) => ({ name: c.channel || "(other)", sessions: c.sessions })),
    landingPages: ranged?.landing?.length ? ranged.landing : landing.sort((a, b) => b.sessions - a.sessions).map((l) => ({ page: l.page, sessions: l.sessions })),
  };
}

function buildAi(daily: { day: string; citations: number; cited_pages: number }[], gq: { query: string; citations: number }[], cp: { page: string; citations: number }[], win: Window): AiData {
  const between = (d: string, a: string, b: string) => d >= a && d <= b;
  // Range-bound now (per-day from the CSV). The series is the in-range days that
  // actually have data — the chart line simply ends at the last uploaded day
  // (we never fabricate the gap for not-yet-uploaded recent days).
  const real = daily.filter((r) => between(r.day, win.start, win.end)).sort((a, b) => a.day.localeCompare(b.day));
  const prev = daily.filter((r) => between(r.day, win.compStart, win.compEnd));
  const total = real.reduce((a, r) => a + r.citations, 0);
  const prevTotal = prev.reduce((a, r) => a + r.citations, 0);
  const avgPages = real.length ? Math.round(avg(real.map((r) => r.cited_pages))) : 0;
  const prevAvg = prev.length ? Math.round(avg(prev.map((r) => r.cited_pages))) : 0;

  // Chart series spans the FULL range, 0-padded on days with no uploaded data
  // (so the line fills to 0 + the chart shows those stretches dashed). total /
  // avg / % above are computed only from real days, so the padding never skews
  // them — the percentage change stays as accurate as the data allows.
  const realByDay = new Map(real.map((r) => [r.day, r]));
  const series: { day: string; citations: number; citedPages: number }[] = [];
  for (let d = win.start; d <= win.end; d = addDaysIso(d, 1)) {
    const r = realByDay.get(d);
    series.push({ day: d, citations: r ? r.citations : 0, citedPages: r ? r.cited_pages : 0 });
  }
  return {
    totalCitations: total,
    avgCitedPages: avgPages,
    // CSV-fed but always exact. Delta only when the comparison window actually
    // has citations (pctChange returns null on a zero prior, so no fake +100%).
    deltas: {
      citations: prevTotal > 0 ? pctChange(total, prevTotal) : null,
      citedPages: prevAvg > 0 ? pctChange(avgPages, prevAvg) : null,
    },
    series,
    dataStart: real.length ? real[0].day : null,
    dataEnd: real.length ? real[real.length - 1].day : null,
    groundingQueries: gq.sort((a, b) => b.citations - a.citations).map((r) => ({ label: r.query, citations: r.citations })),
    citedPages: cp.sort((a, b) => b.citations - a.citations).map((r) => ({ label: r.page, citations: r.citations })),
  };
}

// ── Local Search Grid (BrightLocal geo-grid) ────────────────────────────────
type GridRow = {
  report_id: number; keyword_id: number; keyword: string; run_id: number;
  run_date: string; avg_rank: number | string | null;
  num_points: number | null; num_high: number | null; num_med: number | null; num_low: number | null;
  grid_size: string | null; grid_spacing: string | null;
  center_lat: number | string | null; center_lng: number | string | null;
  business_lat: number | string | null; business_lng: number | string | null; business_name: string | null;
  points: { lat: number; lng: number; rank: number; point_id?: string; top?: { rank: number; name: string; reviews: number | null; rating: number | null; isClient: boolean }[] }[] | null;
};
type GridHistRow = { keyword_id: number; run_date: string; avg_rank: number | string | null };
type CompetitorRow = {
  keyword_id: number; rank: number; title: string; avg_rank: number | string | null;
  authority: number | null; links: number | null; num_reviews: number | null;
  review_rating: number | string | null; primary_category: string | null; profile_url: string | null; is_client: boolean;
};

/** numeric columns can arrive as strings (PostgREST preserves precision); coerce. */
const numN = (v: number | string | null): number | null => (v == null ? null : Number(v));

/** Assemble the LocalGrid payload from the live-map rows + history + competitors.
 *  Report-level geo meta is read off the first row (denormalized identically
 *  across a report's keywords). null when the client has no pulled grid. */
function buildLocalGrid(rows: GridRow[], hist: GridHistRow[], comps: CompetitorRow[]): LocalGrid | null {
  if (!rows.length) return null;
  const first = rows[0];

  const histByKw = new Map<number, LocalGridHistoryPoint[]>();
  for (const h of hist) {
    if (!histByKw.has(h.keyword_id)) histByKw.set(h.keyword_id, []);
    histByKw.get(h.keyword_id)!.push({ date: h.run_date, avgRank: numN(h.avg_rank) });
  }
  for (const arr of histByKw.values()) arr.sort((a, b) => a.date.localeCompare(b.date));

  const compByKw = new Map<number, CompetitorRow[]>();
  for (const c of comps) {
    if (!compByKw.has(c.keyword_id)) compByKw.set(c.keyword_id, []);
    compByKw.get(c.keyword_id)!.push(c);
  }
  for (const arr of compByKw.values()) arr.sort((a, b) => a.rank - b.rank);

  const keywords = rows
    .slice()
    .sort((a, b) => a.keyword.localeCompare(b.keyword))
    .map((r) => ({
      keywordId: r.keyword_id,
      keyword: r.keyword,
      runId: r.run_id,
      runDate: r.run_date,
      avgRank: numN(r.avg_rank),
      numPoints: r.num_points ?? (r.points?.length ?? 0),
      bands: { high: r.num_high, med: r.num_med, low: r.num_low },
      points: (r.points ?? []).map((p): LocalGridPoint => ({
        lat: Number(p.lat), lng: Number(p.lng), rank: Number(p.rank), pointId: String(p.point_id ?? ""),
        top: (p.top ?? []).map((b) => ({ rank: Number(b.rank), name: String(b.name), reviews: b.reviews == null ? null : Number(b.reviews), rating: b.rating == null ? null : Number(b.rating), isClient: !!b.isClient })),
      })),
      history: histByKw.get(r.keyword_id) ?? [],
      competitors: (compByKw.get(r.keyword_id) ?? []).map((c) => ({
        rank: c.rank, title: c.title, avgRank: numN(c.avg_rank), authority: c.authority, links: c.links,
        reviews: c.num_reviews, rating: numN(c.review_rating), category: c.primary_category,
        profileUrl: c.profile_url, isClient: c.is_client,
      })),
    }));

  return {
    reportId: first.report_id,
    gridSize: first.grid_size,
    gridSpacing: first.grid_spacing,
    center: first.center_lat != null && first.center_lng != null
      ? { lat: numN(first.center_lat)!, lng: numN(first.center_lng)! } : null,
    business: first.business_lat != null && first.business_lng != null
      ? { lat: numN(first.business_lat)!, lng: numN(first.business_lng)!, name: first.business_name } : null,
    keywords,
  };
}

/** Group the live-map rows by report (location) and build one LocalGrid each,
 *  sorted by business name. hist/comps are keyed by keyword_id (unique per
 *  report), so passing the full sets to each group only attaches its own. */
function buildLocalGrids(rows: GridRow[], hist: GridHistRow[], comps: CompetitorRow[]): LocalGrid[] {
  const byReport = new Map<number, GridRow[]>();
  for (const r of rows) {
    if (!byReport.has(r.report_id)) byReport.set(r.report_id, []);
    byReport.get(r.report_id)!.push(r);
  }
  const grids: LocalGrid[] = [];
  for (const group of byReport.values()) {
    const g = buildLocalGrid(group, hist, comps);
    if (g) grids.push(g);
  }
  return grids.sort((a, b) => (a.business?.name ?? "").localeCompare(b.business?.name ?? "") || a.reportId - b.reportId);
}

/** Trailing-28-day default window (used when no range cookie is set). */
function defaultWindow(maxDay: string): Window {
  const start = addDaysIso(maxDay, -(PERIOD_DAYS - 1));
  const compEnd = addDaysIso(start, -1);
  const compStart = addDaysIso(compEnd, -(PERIOD_DAYS - 1));
  return { start, end: maxDay, compStart, compEnd, maxDay };
}

/** Min/max stored day for this client — bounds the date-range picker. Reads the
 *  per-day search table (the source of the range-flexible metrics). */
export async function fetchSeoDateBounds(clientId: string): Promise<{ minDay: string | null; maxDay: string | null }> {
  const sb = createAdminClient();
  const [minR, maxR] = await Promise.all([
    sb.from("seo_daily_metrics").select("day").eq("client_id", clientId).order("day", { ascending: true }).limit(1).maybeSingle(),
    sb.from("seo_daily_metrics").select("day").eq("client_id", clientId).order("day", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    minDay: (minR.data as { day?: string } | null)?.day ?? null,
    maxDay: (maxR.data as { day?: string } | null)?.day ?? null,
  };
}

export async function loadSeoData(clientId: string, range?: SeoRange): Promise<SeoMock> {
  const sb = createAdminClient();
  const [dailyRes, gaRes, tqRes, tpRes, chRes, lpRes, aiDRes, aiQRes, aiPRes, cfgRes, gridRes, gridHistRes, gridCompRes] = await Promise.all([
    sb.from("seo_daily_metrics").select("source,day,clicks,impressions,position,keywords").eq("client_id", clientId).order("day"),
    sb.from("seo_ga4_daily").select("day,sessions,users,conversions,engaged_sessions,avg_engagement_sec,page_views").eq("client_id", clientId).order("day"),
    sb.from("seo_top_queries").select("source,query,clicks,impressions,ctr,position").eq("client_id", clientId),
    sb.from("seo_top_pages").select("source,page,clicks,impressions,ctr,position").eq("client_id", clientId),
    sb.from("seo_ga4_channels").select("channel,sessions,conversions").eq("client_id", clientId),
    sb.from("seo_ga4_landing_pages").select("page,sessions").eq("client_id", clientId),
    sb.from("seo_ai_daily").select("day,citations,cited_pages").eq("client_id", clientId).order("day"),
    sb.from("seo_ai_grounding_queries").select("query,citations").eq("client_id", clientId),
    sb.from("seo_ai_cited_pages").select("page,citations").eq("client_id", clientId),
    sb.from("client_seo_config").select("ga4_property_id").eq("client_id", clientId).maybeSingle(),
    // Local Search Grid (BrightLocal geo-grid) — the live map rows + the thin
    // avg-rank history. Resilient: a select error (e.g. before migration 039)
    // yields no rows → buildLocalGrid returns null → the map section stays hidden.
    sb.from("seo_local_grid").select("report_id,keyword_id,keyword,run_id,run_date,avg_rank,num_points,num_high,num_med,num_low,grid_size,grid_spacing,center_lat,center_lng,business_lat,business_lng,business_name,points").eq("client_id", clientId),
    sb.from("seo_local_grid_history").select("keyword_id,run_date,avg_rank").eq("client_id", clientId).order("run_date"),
    sb.from("seo_local_grid_competitors").select("keyword_id,rank,title,avg_rank,authority,links,num_reviews,review_rating,primary_category,profile_url,is_client").eq("client_id", clientId),
  ]);

  const daily = (dailyRes.data ?? []) as DailyRow[];
  const allDays = daily.map((r) => r.day).sort();
  const maxDay = allDays.length ? allDays[allDays.length - 1] : addDaysIso(new Date().toISOString().slice(0, 10), -3);

  // The window the range-flexible parts compute over: the page's resolved range
  // (cookie/preset, clamped) or the trailing-28-day default.
  const win: Window = range ? { ...range, maxDay } : defaultWindow(maxDay);

  // Exact distinct-keyword counts (period / comparison / trailing-year) from the
  // seo_query_daily presence table — counted in SQL over each exact range (distinct
  // isn't additive across days). Resilient: 0 on any error (before migration 035 /
  // first backfill) → buildSource falls back to the top-queries snapshot count.
  // Keywords is a POINT-IN-TIME count: distinct terms ranked for on the latest
  // COMPLETE day — the freshest stored day minus the settling tail, never past
  // the picker's end. The delta compares it to the MATCHING day in the vs period
  // (same offset from that period's end). Single-day counts via the RPC.
  // Resilient: 0 on any error (pre-035 / first backfill) → buildSource falls
  // back to the top-queries snapshot count.
  const kwCount = async (day: string): Promise<number> => {
    try {
      const { data, error } = await sb.rpc("seo_keyword_count", { p_client: clientId, p_source: "google", p_start: day, p_end: day });
      return !error && typeof data === "number" ? data : 0;
    } catch {
      return 0;
    }
  };
  const settledMax = addDaysIso(maxDay, -SETTLING_DAYS);
  const latestFullDay = win.end < settledMax ? win.end : settledMax;
  const compareDay = addDaysIso(win.compEnd, -dayDiff(latestFullDay, win.end));
  const [kwLatest, kwPrevDay] = await Promise.all([kwCount(latestFullDay), kwCount(compareDay)]);

  // Ranged breakdowns — top queries/pages + GA4 channels/landing aggregated over
  // the EXACT selected window (so they follow the picker), plus exact period-
  // distinct GA4 users. All resilient: empty/undefined on error → the builders
  // fall back to the snapshot tables / the summed-daily users.
  const rpcRows = async (fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>[]> => {
    try {
      const { data, error } = await sb.rpc(fn, args);
      return !error && Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  };
  const ga4Prop = (cfgRes.data as { ga4_property_id?: string } | null)?.ga4_property_id ?? null;
  const [rQ, rP, rC, rL, rUsers] = await Promise.all([
    rpcRows("seo_top_queries_ranged", { p_client: clientId, p_source: "google", p_start: win.start, p_end: win.end, p_limit: 100 }),
    rpcRows("seo_top_pages_ranged", { p_client: clientId, p_source: "google", p_start: win.start, p_end: win.end, p_limit: 100 }),
    rpcRows("seo_ga4_channels_ranged", { p_client: clientId, p_start: win.start, p_end: win.end }),
    rpcRows("seo_ga4_landing_ranged", { p_client: clientId, p_start: win.start, p_end: win.end, p_limit: 15 }),
    ga4Prop
      ? fetchGa4PeriodUsers(ga4Prop, [{ start: win.start, end: win.end }, { start: win.compStart, end: win.compEnd }]).catch(() => null)
      : Promise.resolve(null),
  ]);
  const rangedQueries: QueryRow[] = rQ.map((r) => ({ query: String(r.query), clicks: Number(r.clicks), impressions: Number(r.impressions), ctr: Number(r.ctr), position: Number(r.position) }));
  const rangedPages: PageRow[] = rP.map((r) => ({ page: String(r.page), clicks: Number(r.clicks), impressions: Number(r.impressions), ctr: Number(r.ctr), position: Number(r.position) }));
  const rangedChannels = rC.map((r) => ({ name: String(r.channel || "(other)"), sessions: Number(r.sessions) }));
  const rangedLanding = rL.map((r) => ({ page: String(r.page || "(direct)"), sessions: Number(r.sessions) }));
  const ga4Users = rUsers ? { period: Number(rUsers[0] ?? 0), prev: Number(rUsers[1] ?? 0) } : undefined;

  // The AI Performance section always shows the FULL uploaded AI history (not
  // the picker's range), so build a second AI payload over the AI data's own
  // span. Its comparison window sits before the data → it carries no % deltas.
  const aiRows = (aiDRes.data ?? []) as { day: string; citations: number; cited_pages: number }[];
  const aiDays = aiRows.map((r) => r.day).sort();
  const aiWin: Window = aiDays.length
    ? { start: aiDays[0], end: aiDays[aiDays.length - 1], compStart: addDaysIso(aiDays[0], -2), compEnd: addDaysIso(aiDays[0], -1), maxDay: aiDays[aiDays.length - 1] }
    : win;

  return {
    period: {
      start: win.start,
      end: win.end,
      label: fmtRange(win.start, win.end),
      comparisonLabel: `vs ${fmtRange(win.compStart, win.compEnd)}`,
    },
    google: buildSource("google", daily, (tqRes.data ?? []) as TopQ[], (tpRes.data ?? []) as TopP[], win, { latest: kwLatest, prevDay: kwPrevDay }, { queries: rangedQueries, pages: rangedPages }),
    bing: buildSource("bing", daily, (tqRes.data ?? []) as TopQ[], (tpRes.data ?? []) as TopP[], win),
    ga4: buildGa4((gaRes.data ?? []) as GaDaily[], (chRes.data ?? []) as never[], (lpRes.data ?? []) as never[], win, { channels: rangedChannels, landing: rangedLanding, users: ga4Users }),
    ai: buildAi((aiDRes.data ?? []) as never[], (aiQRes.data ?? []) as never[], (aiPRes.data ?? []) as never[], win),
    aiAll: buildAi((aiDRes.data ?? []) as never[], (aiQRes.data ?? []) as never[], (aiPRes.data ?? []) as never[], aiWin),
    localGrids: buildLocalGrids((gridRes.data ?? []) as GridRow[], (gridHistRes.data ?? []) as GridHistRow[], (gridCompRes.data ?? []) as CompetitorRow[]),
  };
}
