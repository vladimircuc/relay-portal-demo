/**
 * Type definitions for the SEO dashboard payload (the `SeoMock` shape — name
 * kept for import stability). The live read layer (lib/seo-data.ts) assembles
 * this from Postgres and <SeoDashboard> renders it. The design-preview mock
 * data that once lived here was removed when the tab shipped on real data.
 */

export type SeoSource = "google" | "bing";
export type SeoMetricKey = "clicks" | "impressions" | "keywords" | "ctr" | "position";

export type DailyPoint = {
  day: string; clicks: number; impressions: number; keywords: number; position: number;
  /** Website-sourced GHL leads for the day — only populated when the client has
   *  "Show leads" on. Merged onto the top-section series so the existing chart
   *  can plot them; absent (undefined) otherwise. Leads-only (no revenue). */
  leads?: number;
};
export type QueryRow = { query: string; clicks: number; impressions: number; ctr: number; position: number };
export type PageRow = { page: string; clicks: number; impressions: number; ctr: number; position: number };

export type SourceTotals = { clicks: number; impressions: number; keywords: number; ctr: number; position: number };
// Deltas allow null for periods we can't compare (e.g. no prior-year data, or
// keyword counts where we don't store a prior-period distinct count).
export type SourceDeltas = { clicks: number | null; impressions: number | null; keywords: number | null; ctr: number | null; position: number | null };

export type SourceData = {
  totals: SourceTotals;
  deltas: SourceDeltas;
  series: DailyPoint[];
  yearSeries: DailyPoint[];
  yearTotals: SourceTotals;
  yearDeltas: SourceDeltas;
  topQueries: QueryRow[];
  topPages: PageRow[];
};

export type Ga4Channel = { name: string; sessions: number };
export type Ga4Landing = { page: string; sessions: number };
export type Ga4Data = {
  totals: { sessions: number; users: number; pageViews: number; conversions: number; engagementRate: number; avgEngagementSec: number };
  // null when there's no full prior period to compare against (e.g. the selected
  // range reaches the start of stored data) — the UI then shows no % badge.
  deltas: { sessions: number | null; users: number | null; pageViews: number | null; conversions: number | null; engagementRate: number | null };
  channels: Ga4Channel[];
  landingPages: Ga4Landing[];
};

export type AiCitePoint = { day: string; citations: number; citedPages: number };
export type AiRow = { label: string; citations: number };
export type AiData = {
  totalCitations: number;
  avgCitedPages: number;
  deltas: { citations: number | null; citedPages: number | null };
  /** Full selected range, 0-padded on days with no uploaded CSV data (so the
   *  chart fills to 0 + renders those stretches dashed). */
  series: AiCitePoint[];
  /** First / last day in the range that actually has uploaded data — the solid
   *  span of the chart; days outside it are the 0-padded dashed stretches. Null
   *  when the range has no AI data at all. */
  dataStart: string | null;
  dataEnd: string | null;
  groundingQueries: AiRow[];
  citedPages: AiRow[];
};

// ── Local Search Grid (BrightLocal geo-grid) — the `seo` upsell's map ─────────
// pointId is BrightLocal's grid-point id (the on-demand fallback fetch key).
// `top` is the PRELOADED "who ranks here" list (top 3 + the client's own row if
// outside top 3), stored at backfill time so the hover popup is instant.
export type LocalGridPointBusiness = { rank: number; name: string; reviews: number | null; rating: number | null; isClient: boolean };
export type LocalGridPoint = { lat: number; lng: number; rank: number; pointId: string; top: LocalGridPointBusiness[] };
export type LocalGridHistoryPoint = { date: string; avgRank: number | null };
/** One row in the per-keyword "top ranking competitors" table. */
export type LocalGridCompetitor = {
  rank: number;
  title: string;
  avgRank: number | null;
  authority: number | null;
  links: number | null;
  reviews: number | null;
  rating: number | null;
  category: string | null;
  profileUrl: string | null;
  isClient: boolean;
};
export type LocalGridKeyword = {
  keywordId: number;
  keyword: string;
  runId: number;        // BrightLocal run id — needed for the on-demand point popup
  runDate: string;
  avgRank: number | null;
  numPoints: number;
  /** Rank-band point counts from BrightLocal's run summary (top / mid / low). */
  bands: { high: number | null; med: number | null; low: number | null };
  points: LocalGridPoint[];
  history: LocalGridHistoryPoint[];
  competitors: LocalGridCompetitor[];
};
export type LocalGrid = {
  reportId: number;
  gridSize: string | null;
  gridSpacing: string | null;
  center: { lat: number; lng: number } | null;
  business: { lat: number; lng: number; name: string | null } | null;
  keywords: LocalGridKeyword[];
};

/** Website-leads summary for the top section's swapped tile. Present only when
 *  the client has the toggle on; the per-day series lives merged on
 *  `google.series` (DailyPoint.leads). Leads-only — no revenue. */
export type SeoLeads = {
  totals: { leads: number };
  deltas: { leads: number | null };
};

export type SeoMock = {
  period: { start: string; end: string; label: string; comparisonLabel: string };
  google: SourceData;
  bing: SourceData;
  ga4: Ga4Data;
  /** Range-bound (follows the date picker) — drives the top "AI citations" tile + chart. */
  ai: AiData;
  /** The FULL uploaded AI history (ignores the picker) — drives the dedicated AI
   *  Performance section, which always shows everything that's been uploaded. */
  aiAll: AiData;
  /** One entry per configured + pulled BrightLocal report (location). Empty for
   *  web-only clients, or a `seo` client whose grid(s) haven't been pulled yet.
   *  The dashboard renders one grid section per entry, stacked. */
  localGrids: LocalGrid[];
  /** Set only when "Show leads" is on. Drives the top section's Website Leads
   *  tile (which replaces CTR; Avg Position stays). */
  leads?: SeoLeads;
};
