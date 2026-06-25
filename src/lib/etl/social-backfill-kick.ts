/**
 * Best-effort, fire-and-forget kick of the heavy social backfill.
 *
 * Called from the connect flows (the edge OAuth callbacks + the Meta page-picker
 * server action) right after a DIFFERENT account is connected on a platform.
 * Under account-scoped retention (migration 028) that connect starts a FRESH
 * series keyed by the new account_id — the old account's history stays in place
 * but dormant, nothing is wiped — and this kick populates the new account. The
 * backfill itself is minutes long (Instagram alone is ~3.5 min of throttled
 * 1-call-per-day insights) so it can't run inside an edge callback or block a
 * server action's redirect — it lives in the Node /api/social/backfill route
 * (300s budget). We POST to that route with the internal CRON_SECRET bearer +
 * background=1 (so the route returns 202 immediately and does the work in its
 * own after()), scheduled via after() here so it never blocks the user's
 * post-connect redirect.
 *
 * Intentionally best-effort: if the kick can't fire (no CRON_SECRET in env, e.g.
 * local dev) or the request is dropped, no data is lost — the new account's rows
 * just start accruing from the nightly cron's sliding re-pull, and the manual
 * "Backfill" button can fill the deeper history on demand. Durable/queued
 * on-connect execution is folded into the onboarding/cron task.
 */
import { after } from "next/server";
import type { SocialPlatform } from "@/lib/etl/social";

/**
 * Resolve this deployment's own origin for a self-POST. Prefer the live
 * request's origin (always correct, even on preview URLs); fall back to env on
 * Vercel for callers without a Request (e.g. the Meta page-picker server action).
 */
export function resolveOrigin(requestUrl?: string): string | null {
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin;
    } catch {
      /* fall through to env */
    }
  }
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

export function kickSocialBackfill(opts: {
  origin: string | null;
  clientId: string;
  /** Omit to backfill every connected platform. */
  platform?: SocialPlatform;
}): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(
      "[social-backfill-kick] CRON_SECRET not set — skipping on-connect backfill " +
        "kick; the nightly cron will refill the history.",
    );
    return;
  }
  if (!opts.origin) {
    console.warn("[social-backfill-kick] could not resolve app origin — skipping backfill kick.");
    return;
  }
  const qs = new URLSearchParams({ clientId: opts.clientId, background: "1" });
  if (opts.platform) qs.set("platform", opts.platform);
  const target = `${opts.origin}/api/social/backfill?${qs.toString()}`;

  // Run after the response (redirect) is flushed. The Node route returns 202
  // fast, so this fetch resolves quickly and the heavy work continues in that
  // route's own invocation, on its own 300s budget.
  after(async () => {
    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn(`[social-backfill-kick] ${target} → HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn(
        `[social-backfill-kick] kick failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });
}
