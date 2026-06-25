/**
 * Local Search Grid pull — reads a client's BrightLocal geo-grid report and
 * mirrors its LATEST run per keyword into Postgres for the Local SEO map on the
 * Web & SEO tab. READ-ONLY: runs are created + scheduled inside BrightLocal, so
 * nothing here triggers a (paid) grid run — we only fetch already-computed
 * results, which is free.
 *
 *   - get_lsg_report        → keywords + grid geometry + business location
 *   - get_lsg_latest_run    → 49 grid points (lat/lng/rank) + summary, per kw
 *   - get_lsg_report_runs   → (backfill only) historical runs → seed the
 *                             avg-rank-over-time trend; the daily pull just
 *                             appends the latest run to that history.
 *
 * Writes:
 *   - seo_local_grid          (REPLACED per client each pull — the live map)
 *   - seo_local_grid_history  (UPSERT by run_id — never deletes; accumulates)
 *
 * A client with no rows in `client_lsg_reports` (no linked reports) is skipped
 * cheaply (no-op), exactly like runSeoDailyPull does for an unconfigured client.
 * A client can link MANY reports (one per location); each is pulled in turn and
 * its rows tagged with report_id so the read layer renders one grid per location.
 *
 * Called via withEtlRun from the nightly cron + /api/etl/seo-grid/[clientId].
 */
import { createAdminClient } from "@/lib/supabase/server";
import {
  withBrightLocal, getLsgReport, getLsgLatestRun, getLsgReportRuns, findLsgReports, getLsgCompetitors, getLsgPointResults,
  type BrightLocalCall, type LsgRun, type LsgRunListItem, type LsgReportSummary,
} from "./brightlocal";

/** Preloaded "who ranks here" entry stored on each grid point. */
type PointTop = { rank: number; name: string; reviews: number | null; rating: number | null; isClient: boolean };
/** keyword_id → ("lat,lng" → its last-known top list), carried across a daily
 *  (non-full) pull so we keep the per-point detail without re-fetching it. */
type PriorTop = Map<number, Map<string, PointTop[]>>;
const llKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
import type { EtlPullResult, EtlBreakdownItem } from "./runs";

/** List every LSG report in the BrightLocal account, summarised + sorted by
 *  business name, for the settings report picker. Throws if the key/API is
 *  unavailable — the loader catches and falls back to a manual id field. */
export async function listLsgReports(): Promise<LsgReportSummary[]> {
  return withBrightLocal(async (call) => {
    const { items } = await findLsgReports(call);
    return (items ?? [])
      .map((r) => ({
        reportId: r.report_id,
        name: r.gmb_info?.name ?? `Report ${r.report_id}`,
        locationId: r.location_id,
        gridSize: r.grid_size,
        numKeywords: (r.keywords ?? []).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Normalize whatever date a run carries (ISO, "YYYY-MM-DD", or datetime) to
 *  yyyy-MM-dd. Returns null if nothing parseable is present. */
function isoDay(...candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    const m = c.match(/^\d{4}-\d{2}-\d{2}/);
    if (m) return m[0];
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;

/** Pull avg_rank out of a run-list item (summary.avg_rank or a top-level field). */
function itemAvgRank(it: LsgRunListItem): number | null {
  return numOrNull(it.summary?.avg_rank) ?? numOrNull(it.avg_rank);
}
function itemRunId(it: LsgRunListItem): number | null {
  return numOrNull(it.run_id) ?? numOrNull(it.id);
}

/** Row collectors shared across all of a client's reports in one pull. */
type Sinks = {
  gridRows: Record<string, unknown>[];
  historyRows: Record<string, unknown>[];
  compRows: Record<string, unknown>[];
  breakdown: EtlBreakdownItem[];
};

/** Pull ONE report (= one location): its keywords' latest runs + competitors,
 *  appending into the shared sinks. Rows are tagged with report_id so the read
 *  layer can render one grid section per location. */
async function pullReport(call: BrightLocalCall, clientId: string, reportId: number, full: boolean, priorTop: PriorTop, sinks: Sinks): Promise<void> {
  const report = await getLsgReport(call, reportId);
  const center = report.grid_center_geo_coordinates;
  const business = report.business_geo_coordinates;
  const businessName = report.gmb_info?.name ?? null;
  const clientCid = report.gmb_info?.cid ?? null; // flag the client's own row in the competitor list

  for (const kw of report.keywords ?? []) {
    try {
      const run: LsgRun = await getLsgLatestRun(call, reportId, kw.id);
      // A keyword with no finished run yet returns nothing usable — skip it
      // (don't crash the whole pull) and flag it in the breakdown.
      if (!run || !Array.isArray(run.grid_points)) {
        sinks.breakdown.push({ key: kw.keyword, ok: false, rows: 0, error: "no finished run" });
        continue;
      }
      // Per-point "who ranks here" (top 3 + the client's own row). On a backfill
      // we fetch it for every point (1 call each — the heavy part, hence
      // backfill-only); a daily pull reuses the last-known detail by location so
      // the hover popup stays instant without re-paginating every point nightly.
      const priorForKw = priorTop.get(kw.id);
      const points: Record<string, unknown>[] = [];
      for (const p of run.grid_points ?? []) {
        let top: PointTop[] = [];
        if (full) {
          try {
            const { items } = await getLsgPointResults(call, reportId, run.run_id, kw.id, p.point_id);
            const ranked = items ?? [];
            top = ranked.slice(0, 3).map((b) => ({ rank: b.rank, name: b.name, reviews: numOrNull(b.num_reviews), rating: numOrNull(b.review_rating), isClient: !!b.is_customer_business }));
            const me = ranked.find((b) => b.is_customer_business);
            if (me && !top.some((b) => b.isClient)) top.push({ rank: me.rank, name: me.name, reviews: numOrNull(me.num_reviews), rating: numOrNull(me.review_rating), isClient: true });
          } catch { /* one bad point shouldn't drop the keyword */ }
        } else {
          top = priorForKw?.get(llKey(p.latitude, p.longitude)) ?? [];
        }
        points.push({ lat: p.latitude, lng: p.longitude, rank: p.rank, point_id: p.point_id, top });
      }
      const runDate = isoDay(run.end_date, run.start_date) ?? new Date().toISOString().slice(0, 10);
      const s = run.summary ?? {};

      sinks.gridRows.push({
        client_id: clientId,
        report_id: reportId,
        keyword_id: kw.id,
        keyword: kw.keyword,
        run_id: run.run_id,
        run_date: runDate,
        avg_rank: numOrNull(s.avg_rank),
        num_points: numOrNull(s.num_points) ?? points.length,
        num_high: numOrNull(s.num_high_ranking_points),
        num_med: numOrNull(s.num_med_ranking_points),
        num_low: numOrNull(s.num_low_ranking_points),
        grid_size: report.grid_size ?? null,
        grid_spacing: report.grid_point_spacing ?? null,
        center_lat: center?.latitude ?? null,
        center_lng: center?.longitude ?? null,
        business_lat: business?.latitude ?? null,
        business_lng: business?.longitude ?? null,
        business_name: businessName,
        points,
        updated_at: new Date().toISOString(),
      });

      // History: always record the latest run; on a backfill also pull the
      // full run list so the trend isn't limited to today onward.
      const seen = new Set<number>();
      const pushHist = (runId: number | null, day: string | null, avg: number | null) => {
        if (runId == null || day == null || seen.has(runId)) return;
        seen.add(runId);
        sinks.historyRows.push({ client_id: clientId, keyword_id: kw.id, run_id: runId, run_date: day, avg_rank: avg });
      };
      pushHist(run.run_id, runDate, numOrNull(s.avg_rank));

      if (full) {
        try {
          const { items } = await getLsgReportRuns(call, reportId, kw.id, 1, 100);
          for (const it of items ?? []) {
            pushHist(itemRunId(it), isoDay(it.end_date, it.run_date, it.date, it.start_date), itemAvgRank(it));
          }
        } catch { /* history list is best-effort — the map row already landed */ }
      }

      // Top-ranking competitors for this keyword (one call per keyword). The
      // client's own GBP is flagged by matching the report's cid. Best-effort.
      try {
        const { competitors } = await getLsgCompetitors(call, reportId, run.run_id, kw.id);
        (competitors ?? []).forEach((c, i) => {
          sinks.compRows.push({
            client_id: clientId,
            keyword_id: kw.id,
            rank: i + 1, // list position (already sorted best-first)
            title: c.title,
            avg_rank: numOrNull(c.avg_rank),
            authority: numOrNull(c.authority),
            links: numOrNull(c.links),
            num_reviews: numOrNull(c.num_reviews),
            review_rating: numOrNull(c.review_rating),
            primary_category: c.primary_category ?? null,
            profile_url: c.profile_url ?? null,
            is_client: clientCid != null && c.cid === clientCid,
          });
        });
      } catch { /* competitors are best-effort — the map row already landed */ }

      sinks.breakdown.push({ key: kw.keyword, ok: true, rows: points.length });
    } catch (e) {
      sinks.breakdown.push({ key: kw.keyword, ok: false, rows: 0, error: msg(e) });
    }
  }
}

export async function runLocalGridPull({ clientId, full = false }: { clientId: string; full?: boolean }): Promise<EtlPullResult> {
  const supabase = createAdminClient();
  const { data: reps } = await supabase
    .from("client_lsg_reports")
    .select("report_id")
    .eq("client_id", clientId);
  const reportIds = (reps ?? []).map((r) => (r as { report_id: number }).report_id);
  // No grids configured for this client → no-op (no breakdown = no Slack noise).
  if (!reportIds.length) return { rowsWritten: 0, breakdown: [] };

  // On a daily (non-full) pull we carry the per-point "who ranks here" detail
  // forward (keyed by keyword + location) so the hover popup stays instant
  // without re-fetching 25–49 points per keyword every night. A full backfill
  // ignores this and re-fetches the detail fresh.
  const priorTop: PriorTop = new Map();
  if (!full) {
    const { data: existing } = await supabase.from("seo_local_grid").select("keyword_id, points").eq("client_id", clientId);
    for (const row of (existing ?? []) as { keyword_id: number; points: { lat: number; lng: number; top?: PointTop[] }[] | null }[]) {
      const m = new Map<string, PointTop[]>();
      for (const p of row.points ?? []) {
        if (Array.isArray(p.top) && p.top.length) m.set(llKey(Number(p.lat), Number(p.lng)), p.top);
      }
      if (m.size) priorTop.set(row.keyword_id, m);
    }
  }

  return withBrightLocal(async (call: BrightLocalCall) => {
    const sinks: Sinks = { gridRows: [], historyRows: [], compRows: [], breakdown: [] };
    // Each report = one location; pull them sequentially on the shared session.
    for (const reportId of reportIds) {
      try {
        await pullReport(call, clientId, reportId, full, priorTop, sinks);
      } catch (e) {
        sinks.breakdown.push({ key: `report ${reportId}`, ok: false, rows: 0, error: msg(e) });
      }
    }

    // Replace this client's live-map rows in one shot (across ALL reports, so a
    // removed keyword/report disappears here too), then upsert the history.
    // GUARD: only delete when we actually fetched replacement rows — otherwise a
    // transient total fetch failure (BrightLocal blip during the nightly cron)
    // would wipe the whole map until the next successful pull. With nothing to
    // replace, we keep the prior data and let the next run refresh it.
    if (sinks.gridRows.length) {
      const { error: delErr } = await supabase.from("seo_local_grid").delete().eq("client_id", clientId);
      if (delErr) throw new Error(`seo_local_grid delete: ${delErr.message}`);
      const { error } = await supabase.from("seo_local_grid").insert(sinks.gridRows);
      if (error) throw new Error(`seo_local_grid insert: ${error.message}`);
    } else {
      console.warn(`[runLocalGridPull] ${clientId}: 0 grid rows fetched — preserving existing map rows`);
    }
    if (sinks.historyRows.length) {
      const { error } = await supabase.from("seo_local_grid_history").upsert(sinks.historyRows, { onConflict: "client_id,keyword_id,run_id" });
      if (error) throw new Error(`seo_local_grid_history upsert: ${error.message}`);
    }
    // Replace the competitor set too — same guard (don't wipe on an empty pull),
    // and best-effort (a competitors failure shouldn't fail the whole pull; the
    // map already landed).
    if (sinks.compRows.length) {
      const { error: compDel } = await supabase.from("seo_local_grid_competitors").delete().eq("client_id", clientId);
      if (compDel) console.error("[runLocalGridPull] competitors delete:", compDel.message);
      else {
        const { error } = await supabase.from("seo_local_grid_competitors").insert(sinks.compRows);
        if (error) console.error("[runLocalGridPull] competitors insert:", error.message);
      }
    }

    const totalPoints = sinks.gridRows.reduce((a, r) => a + ((r.points as unknown[])?.length ?? 0), 0);
    return { rowsWritten: totalPoints, breakdown: sinks.breakdown };
  });
}
