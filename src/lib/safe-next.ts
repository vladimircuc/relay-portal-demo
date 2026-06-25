/**
 * Validate an untrusted post-login redirect target.
 *
 * Returns `next` only when it is a SAME-SITE absolute path ("/...") and NOT a
 * protocol-relative URL ("//evil.com", which browsers treat as off-origin).
 * Anything else (absolute URL, missing, malformed) → `fallback`.
 *
 * Shared by the login page (client) and the OAuth callback (server) so the two
 * can never drift on what counts as a safe `next` — closing the open-redirect
 * gap where the client used `next` raw while the server validated it.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback = "/",
): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
