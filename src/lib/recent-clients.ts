/**
 * Per-browser tracking of recently-viewed client slugs, for the header
 * switcher's "Top 5" list.
 *
 * Why this exists:
 *   With ~4 clients the switcher just lists all of them. At 20-50 it
 *   becomes a wall — most admins only actively work with a handful of
 *   clients on any given day. The switcher now shows only the 5 most
 *   recently visited (padded with newest clients if the admin has
 *   visited fewer than 5), plus the "All clients" link for the long tail.
 *
 * Storage: a single comma-separated cookie (`ps_recent_clients`). Written
 * client-side via the RecentClientTracker component on every dashboard
 * load, read server-side via this module when building the switcher props.
 *
 * Why a cookie not a DB table:
 *   - No schema migration / extra writes per request
 *   - Recents aren't sensitive (slugs are public in URLs)
 *   - Persists across sessions in the same browser, which is what a
 *     single agency operator (Vlad on one laptop) actually wants
 *   - Cookie scope is per-browser, not per-user — if a different user
 *     logs in on the same machine they'll briefly see the previous
 *     user's recents until they visit a few of their own clients.
 *     Trade-off we accept; nothing security-sensitive leaks.
 */
// NOTE: this module is imported by both server and client code (the
// RecentClientTracker client component needs the cookie constants).
// Keep it free of any next/headers / fs / DB imports — the server-only
// `readRecentClientSlugs` lives in recent-clients-server.ts.

/** Cookie name. Short to keep request headers small at scale. */
export const RECENT_CLIENTS_COOKIE = "ps_rc";

/** Max number of slugs we store in the cookie — small enough to keep
 *  the cookie tiny, large enough that brief detours don't kick a
 *  regularly-used client out of the list. */
export const RECENT_CLIENTS_MAX_STORED = 10;

/** How many recents the switcher displays. The "All clients" link
 *  handles the rest. */
export const RECENT_CLIENTS_DISPLAY = 5;

/**
 * Order a list of clients by recency (most recent first) and clip to
 * the display limit. Pads with the rest of the list (in input order —
 * the caller decides what "newest" means, typically by created_at desc)
 * so the dropdown isn't empty for a fresh admin who hasn't visited
 * anything yet.
 *
 * Pure function — takes the recents cookie value as a parameter so it
 * can be called from anywhere without async, and so the calling site
 * stays explicit about where the recents came from.
 */
export function orderClientsByRecents<T extends { slug: string }>(
  clients: T[],
  recentSlugs: string[],
  limit: number = RECENT_CLIENTS_DISPLAY,
): T[] {
  if (clients.length === 0) return [];

  // Index by slug for O(1) lookup.
  const bySlug = new Map(clients.map((c) => [c.slug, c]));

  // Build the recents-first ordering, skipping slugs that no longer
  // exist (deleted clients, mistyped cookie, etc.).
  const out: T[] = [];
  const seen = new Set<string>();
  for (const slug of recentSlugs) {
    const c = bySlug.get(slug);
    if (c && !seen.has(slug)) {
      out.push(c);
      seen.add(slug);
      if (out.length >= limit) return out;
    }
  }

  // Pad with the rest of the list (input order — caller's choice).
  for (const c of clients) {
    if (seen.has(c.slug)) continue;
    out.push(c);
    if (out.length >= limit) break;
  }

  return out;
}
