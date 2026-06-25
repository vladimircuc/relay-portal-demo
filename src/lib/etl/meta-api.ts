/**
 * Minimal Meta Marketing API client. Mirrors what the original
 * `meta-daily.gs` Apps Script did — pulls account-level daily insights
 * for an ad account.
 *
 * Always called from the server with the plaintext token (decrypted from
 * Vault inside the caller). NEVER call from the browser.
 *
 * Why a separate file from meta.ts:
 *   This file is pure HTTP + types. No Supabase, no env vars, no logging.
 *   meta.ts handles the credential-load → API-call → DB-upsert workflow.
 */

const META_GRAPH_VERSION = "v24.0";

/**
 * Shape of a single row from Meta's `/insights` endpoint when
 * `time_increment=1` (one row per day). All numeric-looking fields come
 * back as strings — caller should `Number()` them.
 */
export type MetaInsight = {
  date_start: string;
  date_stop?: string;
  reach?: string | number;
  impressions?: string | number;
  frequency?: string | number;
  inline_link_clicks?: string | number;
  cpm?: string | number;
  cpc?: string | number;
  ctr?: string | number;
  spend?: string | number;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
};

/**
 * Fetch one row per day in [since, until] inclusive from a Meta ad
 * account. Works for both the daily "yesterday" pull and the multi-day
 * backfill — Meta accepts any range up to ~37 months; for ranges beyond
 * the API's hard limit, the caller should chunk before calling us.
 *
 * Date format: "yyyy-MM-dd" in the ad account's reporting timezone
 * (Meta interprets the strings that way).
 *
 * Handles `paging.next` automatically so a long range produces all rows
 * even if it spans multiple response pages.
 */
export async function fetchMetaInsights(args: {
  token: string;
  /** Ad account ID in canonical "act_XXXX" form. */
  adAccountId: string;
  since: string;
  until: string;
}): Promise<MetaInsight[]> {
  const { token, adAccountId, since, until } = args;

  const fields = [
    "date_start",
    "reach",
    "impressions",
    "frequency",
    "inline_link_clicks",
    "cpm",
    "cpc",
    "ctr",
    "spend",
    "actions",
    "cost_per_action_type",
  ].join(",");

  const params = new URLSearchParams({
    access_token: token,
    level: "account",
    time_increment: "1",
    fields,
    time_range: JSON.stringify({ since, until }),
    limit: "500",
  });

  let nextUrl: string | null =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(adAccountId)}/insights?${params}`;

  const out: MetaInsight[] = [];

  // Walk every `paging.next` Meta returns so callers never have to.
  while (nextUrl) {
    const res = await fetch(nextUrl, { method: "GET", cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Meta insights request failed (${res.status}): ${body.slice(0, 400)}`,
      );
    }
    const json = (await res.json()) as {
      data?: MetaInsight[];
      paging?: { next?: string };
    };
    if (Array.isArray(json.data)) out.push(...json.data);
    nextUrl = json.paging?.next ?? null;
  }

  return out;
}

/**
 * Detect the "Meta is mid-propagation" signature in a batch of insight rows.
 *
 * When a Meta access token is freshly issued (or `ads_read` permission was
 * just granted to a System User / app), Meta's reporting infrastructure
 * propagates field-level permissions on different timelines:
 *
 *   - `inline_link_clicks`        → works immediately
 *   - `cpm` / `cpc` / `ctr`       → pre-aggregated, work immediately
 *   - `spend` / `impressions` / `reach` → can lag minutes to hours
 *
 * During that window, a backfill returns rows where clicks are present but
 * spend, impressions, and reach all come back as `0` or `null`. The ETL
 * happily upserts those zeros, the dashboard shows "$0 spent / 0 impressions"
 * even though the client is actually spending, and the user has no idea
 * anything went wrong.
 *
 * This function looks at the batch and returns true if the response has
 * the smoking-gun pattern — the majority of days with clicks also have
 * spend == 0. Callers should retry (with backoff) on a true result, and
 * fail loudly if it never resolves.
 *
 * Heuristic:
 *   - Need at least 3 days with link_clicks > 0 to even make a call.
 *     A single-day daily pull doesn't have enough signal — we'd risk
 *     false positives on real low-spend days.
 *   - Flag as partial if >80% of days-with-clicks have spend == 0.
 *     The 80% threshold tolerates a few legitimate zero-spend days
 *     (e.g. ad set paused mid-campaign) without false-positiving.
 */
export function isPartialPropagation(insights: MetaInsight[]): boolean {
  if (insights.length === 0) return false;

  let withClicks = 0;
  let withClicksButNoSpend = 0;
  for (const i of insights) {
    const clicks = Number(i.inline_link_clicks) || 0;
    const spend = Number(i.spend) || 0;
    if (clicks > 0) {
      withClicks++;
      if (spend === 0) withClicksButNoSpend++;
    }
  }

  // Not enough activity to make a determination.
  if (withClicks < 3) return false;

  // > 80% of active days are missing spend → Meta is mid-propagation.
  return withClicksButNoSpend / withClicks > 0.8;
}
