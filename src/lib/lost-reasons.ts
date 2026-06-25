/**
 * Helpers for the "Lost Leads by Reason" donut tab (ads Advanced view).
 *
 * This is an opt-in, per-client feature: GHL gives us a `lostReasonId` on each
 * status="lost" opportunity (resolved to a label via the location's configured
 * lost-reason list). We bucket the period's lost leads by reason.
 *
 * Two deliberate differences from the source-breakdown donut (`sources.ts`):
 *   1. NO slice cap — every reason GHL can still name gets its own slice (the
 *      point: "see all of them"). Two exceptions that can't be named per-id:
 *      leads lost with no reason recorded roll into "No reason given", and leads
 *      whose `lostReasonId` no longer exists in GHL (e.g. the reason list was
 *      rebuilt, minting new ids) roll into a single "Removed reason" bucket.
 *   2. Gated to an explicit allowlist (LOST_REASONS_CLIENTS) — flip a client on
 *      in code; the tab simply doesn't render for anyone else.
 */
import type { SourceBucket } from "./sources";

/**
 * Clients (by slug) for whom the Lost tab is enabled. Add a slug here to turn
 * the feature on for that client — no DB toggle, no admin UI, just code.
 */
export const LOST_REASONS_CLIENTS: ReadonlySet<string> = new Set<string>([
  "varble-orthodontics",
  "stl-sports-clinic",
]);

export function lostReasonsEnabled(slug: string | null | undefined): boolean {
  return !!slug && LOST_REASONS_CLIENTS.has(slug);
}

type LostOppRow = {
  /** GHL lost-reason id, or null when the opp was marked lost without one. */
  lostReasonId: string | null;
};

/** Synthetic key for lost opps that carry no reason id (kept distinct so a
 *  client that doesn't record reasons still shows an honest bucket). */
const NO_REASON = "__no_reason__";

/** Synthetic key for lost opps whose `lostReasonId` no longer resolves to a
 *  reason in GHL (the reason was deleted — typically because the location's
 *  lost-reason list was rebuilt, minting fresh ids). These can't be named
 *  individually, so they collapse into one honest "Removed reason" slice. */
const REMOVED_REASON = "__removed_reason__";

/**
 * Bucket lost opps by reason. Reuses SourceBucket so the donut component can
 * render these slices with the exact same UI as the source breakdown.
 *
 * `reasonNames` maps lostReasonId → human label (from fetchGhlLostReasons).
 * Every returned bucket has value ≥ 1, so every slice is >0% by construction —
 * nothing is rolled up or hidden. Sorted biggest-first.
 */
export function aggregateLostReasons(
  lostOpps: LostOppRow[],
  reasonNames: Map<string, string>,
): SourceBucket[] {
  const total = lostOpps.length;
  if (total === 0) return [];

  // Only collapse unrecognized ids into a single "Removed reason" bucket when we
  // actually have a reason list to compare against. If the map is empty (the GHL
  // fetch failed, or the client configured no reasons), fall back to per-id
  // labels — otherwise a transient API hiccup would mislabel EVERY lead as
  // "removed", which is worse than an honest "Unknown reason (id)".
  const haveMap = reasonNames.size > 0;

  const counts = new Map<string, number>();
  for (const o of lostOpps) {
    const id = o.lostReasonId?.trim();
    let key: string;
    if (!id) key = NO_REASON;
    else if (!haveMap) key = id; // no list to check → keep raw id (labeled Unknown below)
    else if (reasonNames.has(id)) key = id; // still configured in GHL → own named slice
    else key = REMOVED_REASON; // present on the opp but deleted in GHL → grouped
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const buckets: SourceBucket[] = [...counts.entries()].map(([key, value]) => {
    let label: string;
    let raw: string | null;
    if (key === NO_REASON) {
      label = "No reason given";
      raw = null;
    } else if (key === REMOVED_REASON) {
      label = "Removed reason";
      raw = null;
    } else {
      label = reasonNames.get(key) ?? `Unknown reason (${key.slice(-6)})`;
      raw = key;
    }
    return { label, raw, value, share: value / total };
  });

  buckets.sort((a, b) => b.value - a.value);
  return buckets;
}
