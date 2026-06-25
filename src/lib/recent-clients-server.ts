/**
 * Server-only helpers for the recent-clients feature. Lives in a separate
 * file from `recent-clients.ts` because importing `next/headers` from any
 * module that's transitively pulled into a client component (the
 * RecentClientTracker uses the shared cookie-name constant) fails the
 * Turbopack build.
 *
 * Shared constants + pure helpers live in `recent-clients.ts`; THIS file
 * is for anything that needs the request context (cookies, headers, etc.).
 */
import { cookies } from "next/headers";
import {
  RECENT_CLIENTS_COOKIE,
  RECENT_CLIENTS_MAX_STORED,
} from "./recent-clients";

function parse(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, RECENT_CLIENTS_MAX_STORED);
}

/**
 * Read the recent slugs for the current request. Returns an empty array
 * if the cookie is missing (brand-new admin, fresh browser, etc.).
 */
export async function readRecentClientSlugs(): Promise<string[]> {
  const c = await cookies();
  return parse(c.get(RECENT_CLIENTS_COOKIE)?.value);
}
