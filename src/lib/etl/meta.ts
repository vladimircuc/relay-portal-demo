/**
 * High-level Meta pull — does the full credential-load → API-call →
 * DB-upsert workflow for one client.
 *
 * Two call shapes:
 *   - runMetaPull({ clientId })                          → yesterday only
 *   - runMetaPull({ clientId, since, until })            → custom range (backfill)
 *
 * Returns the number of rows written. Caller (the ETL API route or the
 * cron entrypoint) wraps this in withEtlRun() so the result and any
 * thrown errors get logged to `etl_runs`.
 *
 * Idempotent: meta_daily has PRIMARY KEY (client_id, day), so re-running
 * for the same date range just overwrites the existing rows.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "./vault";
import { fetchMetaInsights, isPartialPropagation, type MetaInsight } from "./meta-api";

export type MetaPullArgs = {
  clientId: string;
  /** "yyyy-MM-dd" — optional. When omitted, defaults to "yesterday" in the
   *  client's configured timezone (resolved in runMetaPull step 3). */
  since?: string;
  /** "yyyy-MM-dd" — optional, defaults to `since`. */
  until?: string;
};

export async function runMetaPull(args: MetaPullArgs): Promise<{ rowsWritten: number }> {
  const { clientId } = args;
  const supabase = createAdminClient();

  // 1. Look up credentials.
  const { data: creds, error: credErr } = await supabase
    .from("client_credentials")
    .select("meta_access_token_secret_id, meta_ad_account_id, meta_result_type")
    .eq("client_id", clientId)
    .maybeSingle();
  if (credErr) throw new Error(`Loading Meta credentials failed: ${credErr.message}`);
  if (!creds?.meta_access_token_secret_id || !creds.meta_ad_account_id) {
    throw new Error(
      "Meta credentials not configured for this client. Set the access token and ad account ID in /[clientSlug]/admin first.",
    );
  }

  // 2. Decrypt the token.
  const token = await getVaultSecret(supabase, creds.meta_access_token_secret_id);

  // 3. Date range — default to "yesterday" in the CLIENT'S timezone.
  //    Meta buckets insights by the ad account's local calendar day, so
  //    computing "yesterday" in UTC drifts by a day near the UTC boundary
  //    for non-UTC clients (a US-Central account at 23:30 local is already
  //    "tomorrow" in UTC, so a UTC "yesterday" would skip the day that just
  //    closed locally). We resolve the client's timezone and take the
  //    calendar day there. Only the default path needs this — an explicit
  //    since/until (backfill / custom range) is passed through verbatim.
  let since = args.since;
  if (!since) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("timezone")
      .eq("id", clientId)
      .maybeSingle();
    since = yesterdayYmd((clientRow?.timezone as string | undefined) || "UTC");
  }
  const until = args.until ?? since;

  // 4. Hit Meta — with auto-retry on the partial-propagation signature.
  //    When a Meta access token was just issued / freshly authorized,
  //    Meta's reporting APIs honor inline_link_clicks (and cpm/cpc/ctr)
  //    immediately but propagate spend/impressions/reach later — so we
  //    sometimes get back rows with clicks > 0 but spend == 0. Without
  //    retry we'd silently upsert zeros and the dashboard would report
  //    "no spend" for a real ad account. See isPartialPropagation() docs.
  //
  //    Strategy: try once; if partial, wait 5s and try again; if still
  //    partial, wait 20s and try a third time. If THAT still returns
  //    partial data, fail the ETL with a clear error explaining the
  //    Meta quirk and the user-side recovery (wait + click backfill
  //    again). We deliberately do NOT upsert garbage data — a failed
  //    ETL surfaces in /admin → ETL Status, whereas a silently-empty
  //    dashboard is invisibly broken.
  const insights = await fetchInsightsWithPropagationRetry({
    token,
    adAccountId: creds.meta_ad_account_id,
    since,
    until,
  });

  if (insights.length === 0) {
    // Empty days happen (paused account, zero impressions). Not an error.
    return { rowsWritten: 0 };
  }

  // 5. Reshape and upsert.
  const resultType = creds.meta_result_type || "lead";
  const rows = insights.map((i) => insightToDailyRow(clientId, i, resultType));

  const { error: upErr } = await supabase
    .from("meta_daily")
    .upsert(rows, { onConflict: "client_id,day" });
  if (upErr) throw new Error(`meta_daily upsert failed: ${upErr.message}`);

  return { rowsWritten: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

/**
 * "Yesterday" as a yyyy-MM-dd calendar date in the given IANA timezone
 * (default UTC). We read today's Y/M/D as seen in that zone via
 * Intl.formatToParts, then step back one calendar day with UTC math on
 * those parts — constructed at UTC midnight, so a DST offset can't knock
 * the subtraction across a boundary. A malformed/unknown stored zone
 * falls back to UTC rather than throwing the whole pull.
 */
function yesterdayYmd(timeZone = "UTC"): string {
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).formatToParts(new Date());
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const dt = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Wrap `fetchMetaInsights` with a 3-attempt retry loop that triggers
 * only when the response shows the partial-propagation signature
 * (clicks present, spend / impressions / reach missing). Most calls
 * pass on the first attempt — this only adds latency when Meta is
 * actually mid-propagation, which is rare after the first few minutes
 * of a freshly-issued token.
 *
 * Delays: 0s → 5s → 20s (total worst-case ≈ 25s).
 *
 * Throws a user-facing error if all three attempts return partial data.
 * The error explains the Meta quirk + remediation; the calling withEtlRun
 * wrapper records it as the run's `error_message` so /admin → ETL Status
 * shows it inline.
 */
async function fetchInsightsWithPropagationRetry(args: {
  token: string;
  adAccountId: string;
  since: string;
  until: string;
}): Promise<MetaInsight[]> {
  const delaysMs = [0, 5_000, 20_000];
  let lastInsights: MetaInsight[] = [];
  let attempt = 0;

  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    lastInsights = await fetchMetaInsights(args);
    if (!isPartialPropagation(lastInsights)) {
      return lastInsights;
    }
    attempt++;
  }

  // All retries exhausted with partial data. Don't upsert — fail loudly.
  throw new Error(
    "Meta returned data with clicks present but spend / impressions / reach " +
      "missing across most days. This is a known Meta quirk that happens when " +
      "an access token's permissions are still propagating across their reporting " +
      `systems (saw ${attempt} retries of ${lastInsights.length} days each, all ` +
      "with the same signature). " +
      "WHAT TO DO: wait 5-10 minutes and click 'Run backfill' again. " +
      "If it persists for more than 30 minutes, verify the access token has " +
      "'ads_read' scope on the ad account in Meta Business Manager (Business " +
      "Settings → System Users / Apps → the user/app you generated the token from).",
  );
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getActionValue(
  arr: Array<{ action_type: string; value: string }> | undefined,
  type: string,
): number {
  if (!arr) return 0;
  const found = arr.find((a) => a.action_type === type);
  return found ? num(found.value) : 0;
}

/**
 * Convert one Meta /insights row into a meta_daily upsert payload.
 *
 * cost_per_result: prefer Meta's reported value (cost_per_action_type for
 * the configured result type) if positive; otherwise compute spend/results.
 * Null when results == 0.
 */
function insightToDailyRow(
  clientId: string,
  i: MetaInsight,
  resultType: string,
) {
  const results = getActionValue(i.actions, resultType);
  const spend = num(i.spend);

  let costPerResult: number | null = null;
  if (results > 0) {
    const reported = getActionValue(i.cost_per_action_type, resultType);
    costPerResult = reported > 0 ? reported : spend / results;
  }

  return {
    client_id: clientId,
    day: i.date_start,
    reach: num(i.reach),
    impressions: num(i.impressions),
    frequency: num(i.frequency),
    link_clicks: num(i.inline_link_clicks),
    cpm: num(i.cpm),
    cpc: num(i.cpc),
    ctr: num(i.ctr),
    spend,
    results,
    cost_per_result: costPerResult,
    raw_actions: i.actions ?? null,
    fetched_at: new Date().toISOString(),
  };
}
