"use client";

/**
 * Tiny client component that records "I just viewed this client" into
 * the `ps_rc` cookie, used by the header switcher's recents-first list.
 *
 * Mounted on every per-client dashboard page (/<slug>/ads, /<slug>/admin).
 * Renders nothing — pure side effect.
 *
 * Why client-side and not server-side: server components can't write
 * cookies during render (Next throws "Cookies can only be modified in
 * a Server Action or Route Handler"). We could use middleware or a
 * server action, but a one-line useEffect that pokes document.cookie
 * is dead-simple, has no network round-trip, and the value is read on
 * the NEXT navigation — which is when the switcher needs it anyway.
 *
 * Cookie format: comma-separated slugs, most recent first, capped at
 * RECENT_CLIENTS_MAX_STORED entries.
 */
import { useEffect } from "react";
import {
  RECENT_CLIENTS_COOKIE,
  RECENT_CLIENTS_MAX_STORED,
} from "@/lib/recent-clients";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

export function RecentClientTracker({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return;

    // Read current cookie value.
    const existing = readCookie(RECENT_CLIENTS_COOKIE)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Prepend current slug; dedupe; cap.
    const updated = [slug, ...existing.filter((s) => s !== slug)].slice(
      0,
      RECENT_CLIENTS_MAX_STORED,
    );

    // Write back. Lax SameSite + 90d expiry + path=/ so it works on
    // every page. Not HttpOnly because we're writing from JS — fine,
    // the contents (slugs) aren't sensitive.
    document.cookie =
      `${RECENT_CLIENTS_COOKIE}=${encodeURIComponent(updated.join(","))}; ` +
      `path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
  }, [slug]);

  return null;
}

/** Parse `document.cookie` for a single named cookie. Decodes URL-encoded. */
function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="));
  if (!match) return "";
  return decodeURIComponent(match.slice(name.length + 1));
}
