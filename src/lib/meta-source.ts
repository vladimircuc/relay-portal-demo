/**
 * Is a GHL opportunity's `source` a Meta-ad lead?
 *
 * Clients onboarded the standard way tag the GHL source as "Meta - <ad name>"
 * (e.g. "Meta - Video_v1"), so a Meta lead is one whose source starts with
 * "meta" (case-insensitive, tolerant of a stray leading space). NULL / blank /
 * other sources (Website, Chat Widget, …) are not Meta.
 *
 * This is the TypeScript twin of the SQL `is_meta_lead()` in migration 031 —
 * the SQL gate drives the funnel/hero counts (daily_metrics_v), this drives the
 * source-breakdown donut + per-source projection (Path B). Keep the two in
 * lockstep: same predicate, same edge cases.
 *
 * Only applied for clients with `ads_meta_source_only = true` (the default);
 * opted-out clients (e.g. STL Sports Clinic) skip it and count every source.
 */
export function isMetaLead(source: string | null | undefined): boolean {
  return !!source && source.trimStart().toLowerCase().startsWith("meta");
}

/**
 * Is this opportunity AD-attributed? — the Meta source convention OR a "meta"
 * tag (some clients tag `meta lead` / `meta ads` / `meta` rather than, or in
 * addition to, the source). Ad attribution always wins over website (below).
 */
export function isAdLead(
  source: string | null | undefined,
  tags: string[] | null | undefined,
): boolean {
  if (isMetaLead(source)) return true;
  return (tags ?? []).some((t) => /\bmeta\b/i.test(t));
}

/**
 * Is this a WEBSITE-sourced lead? Universal rule across clients: it's NOT an ad
 * lead, AND it carries a website signal — a `website` tag, or a source that
 * names a website / chat-widget origin. Verified against real GHL data:
 *   - Ballwin: source "Website Consult Request" + `website` tag
 *   - LT's:    source "Website" / "Chat Widget" + `website` tag
 *   - Varble:  its NEW PATIENT pipeline (where site leads live) carries genuine
 *              "Website…" sources ("Website", "website free consult", …) + the
 *              `website` tag — so the rule catches them. Its separate META AD
 *              pipeline stamps every source "Meta - …" (correctly excluded as
 *              ad-attributed). The leads ETL only scans the New Patient pipeline
 *              for Varble (HARDCODED_LEAD_PIPELINES in seo-leads-etl.ts).
 * Future clients onboard the same way (a Website / Chat Widget pipeline source),
 * so this holds without per-client config.
 */
export function isWebsiteLead(
  source: string | null | undefined,
  tags: string[] | null | undefined,
): boolean {
  if (isAdLead(source, tags)) return false; // ad attribution wins — never double-count
  const tagHit = (tags ?? []).some((t) => /website/i.test(t));
  const srcHit = !!source && /website|chat\s*widget/i.test(source);
  return tagHit || srcHit;
}
