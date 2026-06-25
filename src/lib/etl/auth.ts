/**
 * Auth helpers for the ETL API routes. Two kinds of caller need access:
 *
 *   1. The Vercel daily cron — comes in with the `Authorization: Bearer
 *      ${CRON_SECRET}` header that Vercel auto-injects.
 *   2. A super-admin manually clicking "Run now" / "Backfill" in the
 *      admin UI — comes in via a session cookie.
 *
 * `requireEtlAccess` checks both. Returns either { ok: true, by } when
 * the caller is authorized (with `by` indicating which path matched, for
 * audit purposes), or a ready-to-return Response when they aren't.
 *
 * Keep auth logic out of route bodies so we can audit it in one place
 * if we add a third caller (e.g. an admin CLI token) later.
 */
import { getCurrentUser, resolveAccess, canManageScope, type Capability } from "@/lib/auth";

/**
 * Constant-time string comparison for secret/bearer checks — avoids the
 * early-exit timing leak of `===`. Pure JS over UTF-8 bytes so it runs in both
 * the Node and Edge runtimes (Edge lacks node:crypto's timingSafeEqual). The
 * length check is not constant-time, which is standard and acceptable here.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export type EtlAuthOk = { ok: true; by: "cron" | "super_admin" | "scoped_admin"; email?: string };
export type EtlAuthFail = { ok: false; response: Response };
export type EtlAuthResult = EtlAuthOk | EtlAuthFail;

/**
 * Gate an ETL route. Cron (CRON_SECRET) and global super-admins always pass.
 *
 * Pass `scope` to ALSO let a local super-admin who can manage that capability on
 * that client trigger the pull — e.g. the SEO backfill route passes
 * `{ clientId, capability: "web" }` so a Web & SEO local super-admin can run it,
 * not just a global super-admin. Routes without a scope stay super-admin-only.
 */
export async function requireEtlAccess(
  request: Request,
  scope?: { clientId: string; capability: Capability },
): Promise<EtlAuthResult> {
  // ── Cron path ─────────────────────────────────────────────────────────────
  // Vercel cron injects `Authorization: Bearer <CRON_SECRET>` on every
  // scheduled invocation. If that matches, we're good.
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth != null && timingSafeEqualStr(auth, `Bearer ${cronSecret}`)) {
    return { ok: true, by: "cron" };
  }

  // ── Session path ──────────────────────────────────────────────────────────
  const user = await getCurrentUser();
  if (!user?.email) {
    return { ok: false, response: jsonError(401, "Not authenticated") };
  }
  const access = await resolveAccess(user.email);

  // Global super-admin can run any ETL route.
  if (access.kind === "super_admin") {
    return { ok: true, by: "super_admin", email: user.email };
  }
  // Scoped: a local super-admin who manages this capability on this client.
  if (scope && canManageScope(access, scope.clientId, scope.capability)) {
    return { ok: true, by: "scoped_admin", email: user.email };
  }

  return {
    ok: false,
    response: jsonError(
      403,
      scope ? "You don't have permission to manage this for this client" : "Super-admin required",
    ),
  };
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
