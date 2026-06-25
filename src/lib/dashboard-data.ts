/**
 * Server-side data fetchers for the dashboard.
 *
 * Two layers of caching on each fetcher:
 *
 *  1. `unstable_cache` (Next.js Data Cache) — caches results across requests
 *     for 5 minutes, keyed by the primitive args (client + dates). Two users
 *     looking at "Varble · last 30 days" within 5 min share one DB hit.
 *
 *  2. React `cache()` — wraps the unstable_cache call so that within a single
 *     request, multiple sections asking for the same data dedupe to one
 *     in-flight promise (no second DB hit on a cache miss, no second cache
 *     read on a hit).
 *
 * Importantly, `unstable_cache` requires all args to be serializable, so the
 * Supabase admin client is created INSIDE the cached function, not passed in.
 *
 * Cache invalidation:
 *  - All fetchers are tagged `daily-metrics` / `ghl-opps`. Future ETL runs
 *    or admin actions can call `revalidateTag("daily-metrics")` to flush.
 *  - 5-minute revalidate is a hard cap as a fallback.
 */
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "@/lib/etl/vault";
import { fetchGhlLostReasons, type GhlLostReason } from "@/lib/etl/ghl-api";
import { isMetaLead } from "@/lib/meta-source";
import type { DailyMetricsRow } from "@/lib/types";

const REVALIDATE_SECONDS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Daily metrics — single period

const _fetchDailyMetricsRaw = async (
  clientId: string,
  startStr: string,
  endStr: string,
): Promise<DailyMetricsRow[]> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("daily_metrics_v")
    .select("*")
    .eq("client_id", clientId)
    .gte("day", startStr)
    .lte("day", endStr)
    .order("day", { ascending: true });
  return (data ?? []) as DailyMetricsRow[];
};

const _fetchDailyMetricsCached = unstable_cache(
  _fetchDailyMetricsRaw,
  ["daily-metrics-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: ["daily-metrics"] },
);

/** Daily metrics rows for a single client over [startStr, endStr] inclusive. */
export const fetchDailyMetrics = cache(
  (clientId: string, startStr: string, endStr: string) =>
    _fetchDailyMetricsCached(clientId, startStr, endStr),
);

// ─────────────────────────────────────────────────────────────────────────────
// Daily metrics — both current and comparison ranges in one DB roundtrip

const _fetchDailyMetricsBothRaw = async (
  clientId: string,
  startStr: string,
  endStr: string,
  compStartStr: string,
  compEndStr: string,
): Promise<{ current: DailyMetricsRow[]; comparison: DailyMetricsRow[] }> => {
  // Cover both ranges with one query (they're contiguous in the common case,
  // and the lo/hi pick handles any unusual layout).
  const lo = compStartStr < startStr ? compStartStr : startStr;
  const hi = endStr > compEndStr ? endStr : compEndStr;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("daily_metrics_v")
    .select("*")
    .eq("client_id", clientId)
    .gte("day", lo)
    .lte("day", hi)
    .order("day", { ascending: true });

  const rows = (data ?? []) as DailyMetricsRow[];
  const current = rows.filter((r) => r.day >= startStr && r.day <= endStr);
  const comparison = rows.filter((r) => r.day >= compStartStr && r.day <= compEndStr);
  return { current, comparison };
};

const _fetchDailyMetricsBothCached = unstable_cache(
  _fetchDailyMetricsBothRaw,
  ["daily-metrics-both-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: ["daily-metrics"] },
);

/**
 * Fetch BOTH the current and comparison ranges in a single DB roundtrip.
 *
 * Hero / Efficiency / Performance all call this with identical args; React
 * cache() dedupes within a request, unstable_cache shares across requests.
 *
 * NOTE: this assumes the date strings come from `format(d, "yyyy-MM-dd")`
 * (lexicographic comparison works for ISO date strings).
 */
export const fetchDailyMetricsBothPeriods = cache(
  (
    clientId: string,
    startStr: string,
    endStr: string,
    compStartStr: string,
    compEndStr: string,
  ) =>
    _fetchDailyMetricsBothCached(clientId, startStr, endStr, compStartStr, compEndStr),
);

// ─────────────────────────────────────────────────────────────────────────────
// GHL opportunities in a window (used by source breakdown)

/**
 * Pull every opportunity for the client whose created_at_ghl, when
 * interpreted in the CLIENT'S timezone, falls within [startStr, endStr]
 * inclusive.
 *
 * Takes calendar date STRINGS ("yyyy-MM-dd") to avoid the ISO/Date
 * round-trip TZ trap: previously we accepted ISO timestamps, parsed them
 * with `new Date(iso)`, then `fmt.format(date)` to derive boundary
 * strings — but a UTC-midnight Date formatted in Central comes out as
 * the previous day, so the source breakdown was querying Feb 18 – May 18
 * while the funnel was querying Feb 19 – May 19. The 3-lead mismatch the
 * user spotted (94 vs 97) was that boundary slice.
 */
const _fetchOppsInPeriodRaw = async (
  clientId: string,
  timezone: string,
  startStr: string,
  endStr: string,
  metaOnly: boolean,
): Promise<
  {
    source: string | null;
    monetary_value: number;
    pipeline_stage_id: string | null;
    status: string | null;
  }[]
> => {
  // Generous UTC bounds — 2 days on each side handles any timezone and
  // any DST edge case. We filter precisely in JS below using the
  // client's actual TZ.
  const startApproxUtc = new Date(`${startStr}T00:00:00Z`).getTime();
  const endApproxUtc = new Date(`${endStr}T00:00:00Z`).getTime();
  const fromUtc = new Date(startApproxUtc - 2 * 86_400_000).toISOString();
  const toUtc = new Date(endApproxUtc + 2 * 86_400_000).toISOString();

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("ghl_opportunities")
    .select("source, monetary_value, created_at_ghl, pipeline_stage_id, status")
    .eq("client_id", clientId)
    .gte("created_at_ghl", fromUtc)
    .lte("created_at_ghl", toUtc);

  if (!data) return [];

  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });

  return data
    .filter((o) => {
      if (!o.created_at_ghl) return false;
      // Meta-only clients (the default) drop non-Meta-sourced leads so the
      // donut matches the Meta-filtered Hero/funnel. Mirrors the SQL
      // is_meta_lead() gate in daily_metrics_v (migration 031).
      if (metaOnly && !isMetaLead(o.source)) return false;
      // "en-CA" with a date format yields "yyyy-MM-dd" — lexicographic
      // comparison against startStr/endStr (also yyyy-MM-dd) is correct.
      const local = fmt.format(new Date(o.created_at_ghl));
      return local >= startStr && local <= endStr;
    })
    .map((o) => ({
      source: o.source,
      monetary_value: Number(o.monetary_value ?? 0) || 0,
      // Needed so the source-breakdown card can filter "Revenue" to only
      // converted-stage opps, matching the Hero card's revenue definition.
      pipeline_stage_id: o.pipeline_stage_id ?? null,
      // Needed so the Revenue donut can drop converted-stage opps whose deal
      // is abandoned/lost, matching the Hero (migration 032: converted counts
      // only when status is open/won).
      status: o.status ?? null,
    }));
};

// Cache key bumped to v5 — the cached row shape now carries `status` (migration
// 032: the Revenue donut filters converted opps to open/won). v5 retires v4
// blobs that lack the field, which would otherwise read as undefined and wrongly
// drop every converted opp until the cache expired. (v4 had added `metaOnly`,
// which is itself part of the key, so flipping ads_meta_source_only serves fresh.)
const _fetchOppsInPeriodCached = unstable_cache(
  _fetchOppsInPeriodRaw,
  ["ghl-opps-period-v5"],
  { revalidate: REVALIDATE_SECONDS, tags: ["ghl-opps"] },
);

/** Opportunities whose created_at (in client TZ) falls within [startStr, endStr].
 *  When metaOnly, drops non-Meta-sourced leads (see isMetaLead). */
export const fetchOppsInPeriod = cache(
  (clientId: string, timezone: string, startStr: string, endStr: string, metaOnly: boolean) =>
    _fetchOppsInPeriodCached(clientId, timezone, startStr, endStr, metaOnly),
);

// ─────────────────────────────────────────────────────────────────────────────
// Lost reasons (opt-in "Lost" donut tab) — see lib/lost-reasons.ts

/**
 * Lost opportunities created in [startStr, endStr] (client TZ), with each opp's
 * GHL `lostReasonId` pulled out of the stored raw payload.
 *
 * Same period semantics as fetchOppsInPeriod (bucket by creation date) so the
 * "Lost" tab is the directly-comparable subset of the "Leads" tab: of the leads
 * we got this period, these are the ones now lost and why. We read `raw` (only
 * for status='lost' rows, which are few) and extract lostReasonId in JS rather
 * than relying on a Postgres json-arrow select — robust + no schema change.
 */
const _fetchLostOppsInPeriodRaw = async (
  clientId: string,
  timezone: string,
  startStr: string,
  endStr: string,
  metaOnly: boolean,
): Promise<{ lostReasonId: string | null }[]> => {
  const startApproxUtc = new Date(`${startStr}T00:00:00Z`).getTime();
  const endApproxUtc = new Date(`${endStr}T00:00:00Z`).getTime();
  const fromUtc = new Date(startApproxUtc - 2 * 86_400_000).toISOString();
  const toUtc = new Date(endApproxUtc + 2 * 86_400_000).toISOString();

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("ghl_opportunities")
    .select("created_at_ghl, raw, source")
    .eq("client_id", clientId)
    .eq("status", "lost")
    .gte("created_at_ghl", fromUtc)
    .lte("created_at_ghl", toUtc);

  if (!data) return [];

  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });

  return data
    .filter((o) => {
      if (!o.created_at_ghl) return false;
      // Same Meta gate as the leads donut — the Lost tab is the lost subset
      // of those leads, so it must filter identically (migration 031).
      if (metaOnly && !isMetaLead(o.source as string | null)) return false;
      const local = fmt.format(new Date(o.created_at_ghl as string));
      return local >= startStr && local <= endStr;
    })
    .map((o) => {
      const raw = (o.raw ?? null) as { lostReasonId?: string | null } | null;
      const id = raw?.lostReasonId;
      return { lostReasonId: id && String(id).trim() ? String(id) : null };
    });
};

// v2: added the `metaOnly` arg (migration 031) — bump retires v1 blobs cached
// under the old arity, and the arg becomes part of the cache key.
const _fetchLostOppsInPeriodCached = unstable_cache(
  _fetchLostOppsInPeriodRaw,
  ["ghl-lost-opps-period-v2"],
  { revalidate: REVALIDATE_SECONDS, tags: ["ghl-opps"] },
);

export const fetchLostOppsInPeriod = cache(
  (clientId: string, timezone: string, startStr: string, endStr: string, metaOnly: boolean) =>
    _fetchLostOppsInPeriodCached(clientId, timezone, startStr, endStr, metaOnly),
);

/**
 * The client's location-configured lost reasons (id → name). Hits GHL's
 * /opportunities/lost-reason once and caches for 6h — the list is essentially
 * static (reasons are configured rarely). Returns [] (and the UI falls back to
 * a short id label) if credentials are missing or the call fails, so a transient
 * GHL hiccup never crashes the ads page. Only ever called for allowlisted
 * clients on the Advanced view, so this external call is rare + cached.
 */
const _fetchLostReasonMapRaw = async (clientId: string): Promise<GhlLostReason[]> => {
  const supabase = createAdminClient();
  const { data: creds } = await supabase
    .from("client_credentials")
    .select("ghl_token_secret_id, ghl_location_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!creds?.ghl_token_secret_id || !creds.ghl_location_id) return [];
  try {
    const token = await getVaultSecret(supabase, creds.ghl_token_secret_id as string);
    return await fetchGhlLostReasons({ token, locationId: creds.ghl_location_id as string });
  } catch (e) {
    console.error(
      `[lost-reasons] reason-map fetch failed for client ${clientId}:`,
      e instanceof Error ? e.message : e,
    );
    return [];
  }
};

const _fetchLostReasonMapCached = unstable_cache(
  _fetchLostReasonMapRaw,
  // v2: the v1 key cached an empty [] from the era when fetchGhlLostReasons
  // filtered on `r.id` (always undefined — GHL uses `_id`). Bumping the key
  // forces a fresh fetch on deploy instead of serving the stale empty map
  // for up to 6h.
  ["ghl-lost-reason-map-v2"],
  { revalidate: 60 * 60 * 6, tags: ["ghl-opps"] },
);

export const fetchLostReasonMap = cache((clientId: string) => _fetchLostReasonMapCached(clientId));

/**
 * Fetch the list of pipeline_stage_ids that count toward the `converted`
 * phase for this client. Used by the source-breakdown card to filter
 * "Revenue" mode to only closed/converted opps (matching Hero's
 * definition of revenue).
 *
 * Returns an empty array if the client hasn't mapped any stages to the
 * converted phase yet — in that case the source revenue donut shows
 * "no data" rather than incorrectly summing pipeline value.
 */
const _fetchConvertedStageIdsRaw = async (clientId: string): Promise<string[]> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("client_lifecycle_phases")
    .select("pipeline_stage_ids")
    .eq("client_id", clientId)
    .eq("phase_key", "converted")
    .maybeSingle();
  return (data?.pipeline_stage_ids as string[] | undefined) ?? [];
};

const _fetchConvertedStageIdsCached = unstable_cache(
  _fetchConvertedStageIdsRaw,
  ["converted-stage-ids-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: ["lifecycle-phases"] },
);

export const fetchConvertedStageIds = cache(
  (clientId: string) => _fetchConvertedStageIdsCached(clientId),
);

/**
 * Fetch stage-id arrays for every lifecycle phase the client has mapped
 * (booked / no_show / showed / converted). Used for projected mode in
 * the source breakdown: we need to know which opps are still
 * "outstanding" (in booked stages but not in showed / no_show /
 * converted) so we can roll them forward at historical rates and
 * attribute the projected revenue back to their source.
 *
 * Missing phases (the client hasn't mapped a stage to that phase yet)
 * come back as empty arrays.
 */
export type PhaseStageIds = {
  booked: string[];
  no_show: string[];
  showed: string[];
  converted: string[];
};

const _fetchPhaseStageIdsRaw = async (clientId: string): Promise<PhaseStageIds> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("client_lifecycle_phases")
    .select("phase_key, pipeline_stage_ids")
    .eq("client_id", clientId);

  const out: PhaseStageIds = { booked: [], no_show: [], showed: [], converted: [] };
  for (const row of data ?? []) {
    const key = row.phase_key as keyof PhaseStageIds;
    if (key in out) {
      out[key] = (row.pipeline_stage_ids as string[]) ?? [];
    }
  }
  return out;
};

const _fetchPhaseStageIdsCached = unstable_cache(
  _fetchPhaseStageIdsRaw,
  ["phase-stage-ids-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: ["lifecycle-phases"] },
);

export const fetchPhaseStageIds = cache(
  (clientId: string) => _fetchPhaseStageIdsCached(clientId),
);

// ─────────────────────────────────────────────────────────────────────────────
// Date bounds — the three small "what's the period range for this client?"
// queries that block the dashboard render before any streaming starts.
//
// We need: latest day with metrics, earliest opportunity date, last ETL run
// timestamp. They change once per ETL run (≈ once a day), so caching them
// for 5 minutes turns a 3-roundtrip block into a 0-roundtrip block on the
// hot path. This is what makes "click a client → see dashboard" snappy.

export type DateBounds = {
  /** Latest day with daily_metrics for this client (ISO date) — null if none. */
  maxDay: string | null;
  /** Created_at of the first opportunity ever for this client — null if none. */
  firstOppAt: string | null;
  /** Timestamp of the most recent successful ETL run — null if none. */
  lastRunAt: string | null;
};

const _fetchDateBoundsRaw = async (clientId: string): Promise<DateBounds> => {
  const supabase = createAdminClient();
  // Three small lookups in parallel — same as before, just lifted out of
  // page.tsx so we can cache the whole bundle behind one key.
  const [maxDayRes, firstOppRes, lastRunRes] = await Promise.all([
    supabase
      .from("daily_metrics_v")
      .select("day")
      .eq("client_id", clientId)
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("ghl_opportunities")
      .select("created_at_ghl")
      .eq("client_id", clientId)
      .order("created_at_ghl", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("etl_runs")
      .select("finished_at")
      .eq("client_id", clientId)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    maxDay: maxDayRes.data?.day ?? null,
    firstOppAt: firstOppRes.data?.created_at_ghl ?? null,
    lastRunAt: lastRunRes.data?.finished_at ?? null,
  };
};

const _fetchDateBoundsCached = unstable_cache(
  _fetchDateBoundsRaw,
  ["date-bounds-v1"],
  { revalidate: REVALIDATE_SECONDS, tags: ["daily-metrics", "etl-runs"] },
);

export const fetchDateBounds = cache(
  (clientId: string) => _fetchDateBoundsCached(clientId),
);
