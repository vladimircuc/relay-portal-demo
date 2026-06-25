/**
 * Helpers for the Meta (Facebook + Instagram) OAuth flow used by the
 * Socials module. Lives in lib/ so both the start and callback routes
 * can share scopes, state signing, and the Graph API base URL.
 *
 * One OAuth grant covers BOTH Facebook Page analytics and the Instagram
 * Business Account linked to that Page — Meta bundles them under a
 * single "Facebook Login for Business" flow.
 *
 * Scopes we request:
 *   pages_show_list           — list the pages this user can manage
 *   pages_read_engagement     — read post-level engagement (clicks, reactions)
 *   read_insights             — read Page Insights / analytics
 *   instagram_basic           — basic IG account access
 *   instagram_manage_insights — read IG Insights / analytics
 *   business_management       — for pages inside a Business portfolio
 *
 * The `read_insights` and `instagram_manage_insights` scopes both need
 * Advanced Access in App Review before we can onboard outside clients in
 * production. For development against your own pages, Standard Access
 * is sufficient.
 */

export const META_API_VERSION = "v25.0";

export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "read_insights",
  "instagram_basic",
  "instagram_manage_insights",
  "business_management",
] as const;

/**
 * Build the OAuth dialog URL that the user's browser is redirected to
 * when they click "Connect Facebook + Instagram". After granting (or
 * denying) permissions, Meta redirects to `redirectUri` with `?code=...`
 * (success) or `?error=...` (failure), plus our `state` echoed back.
 */
export function buildOAuthDialogUrl(args: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.appId,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: "code",
    scope: META_OAUTH_SCOPES.join(","),
    // Force the consent screen even on re-auth so the user can pick a
    // different Page if they manage multiple. Without this, Meta
    // silently re-grants and we'd never see the picker.
    auth_type: "rerequest",
  });
  return `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?${params}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// State signing
//
// The OAuth `state` parameter prevents CSRF — the callback must verify
// it issued the state itself. We HMAC the (clientId, returnTo, timestamp)
// with META_APP_SECRET as the key and bundle them into a single opaque
// string:
//
//   <clientId>.<returnTo>.<timestamp>.<hmac-hex>
//
// `returnTo` ("admin" | "socials") records which surface kicked off the
// connect so the callback can land the user back where they started — the
// admin Credentials page or the Socials dashboard's connect modal.
//
// On callback: re-compute the HMAC, compare; reject if mismatched or older
// than the TTL. Avoids needing a server-side store of pending OAuth
// transactions. The verifier still accepts the legacy 3-part format
// (<clientId>.<ts>.<sig>, returnTo defaulted to "admin") so any OAuth that
// was already mid-flight across a deploy doesn't break.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — covers slow consent screens

export type MetaReturnTo = "admin" | "socials";

export async function signState(args: {
  clientId: string;
  secret: string;
  returnTo?: MetaReturnTo;
}): Promise<string> {
  const ts = Date.now().toString();
  const returnTo: MetaReturnTo = args.returnTo ?? "admin";
  const payload = `${args.clientId}.${returnTo}.${ts}`;
  const sig = await hmacHex(args.secret, payload);
  return `${payload}.${sig}`;
}

export type StateVerification =
  | { ok: true; clientId: string; returnTo: MetaReturnTo }
  | { ok: false; reason: string };

export async function verifyState(args: {
  state: string;
  secret: string;
}): Promise<StateVerification> {
  const parts = args.state.split(".");
  // New format: clientId.returnTo.ts.sig (4 parts).
  // Legacy format: clientId.ts.sig (3 parts) — returnTo defaults to "admin".
  if (parts.length !== 3 && parts.length !== 4) {
    return { ok: false, reason: "Malformed state" };
  }
  const isNew = parts.length === 4;
  const clientId = parts[0];
  const returnToRaw = isNew ? parts[1] : "admin";
  const tsStr = isNew ? parts[2] : parts[1];
  const sig = isNew ? parts[3] : parts[2];
  const payload = isNew ? `${clientId}.${returnToRaw}.${tsStr}` : `${clientId}.${tsStr}`;

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, reason: "Bad timestamp" };
  if (Date.now() - ts > STATE_TTL_MS) {
    return { ok: false, reason: "State expired — please retry the connect flow" };
  }
  const expected = await hmacHex(args.secret, payload);
  // Constant-time string compare (cheap version — both strings are hex of
  // known length, so a length check + bitwise comparison is sufficient).
  if (sig.length !== expected.length) return { ok: false, reason: "Bad signature" };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "Bad signature" };
  const returnTo: MetaReturnTo = returnToRaw === "socials" ? "socials" : "admin";
  return { ok: true, clientId, returnTo };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  // Web Crypto — works in both Edge and Node runtimes without polyfills.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Derive the absolute callback URL from the current request. We don't
 * hardcode the origin so the same code works on localhost dev and on
 * Vercel prod without env juggling — Meta only cares that the redirect
 * matches one of the URIs we registered in App Settings.
 */
export function callbackUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/api/auth/meta/callback`;
}
