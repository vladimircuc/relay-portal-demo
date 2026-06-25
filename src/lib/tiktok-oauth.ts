/**
 * Helpers for TikTok's OAuth v2 flow used by the Socials module.
 *
 * Differences from Meta and YouTube:
 *
 *   1. Parameter naming: TikTok uses `client_key` (not `client_id`) +
 *      `client_secret`. Forgetting this gets you a generic "invalid
 *      parameter" 400 with no useful detail.
 *
 *   2. Refresh tokens AUTO-ROTATE: every call to the refresh endpoint
 *      returns a NEW refresh_token that supersedes the old one. The
 *      ETL has to persist the new refresh_token after every refresh,
 *      not just the first time.
 *
 *   3. Access tokens live ~24h (longer than Google's 1h), refresh
 *      tokens live ~1 year unless rotated sooner.
 *
 * Scopes we request (organic content reading):
 *   user.info.basic    — open_id, union_id, avatar, display_name
 *   user.info.profile  — @handle, bio, profile URL
 *   user.info.stats    — follower / following / likes / video counts
 *   video.list         — list of the user's videos, INCLUDING per-video
 *                        stats (view_count, like_count, comment_count,
 *                        share_count, play_count) bundled inline
 *
 * NOTE: `video.insights` is intentionally NOT requested here. That scope
 * is gated behind a separate TikTok product (Content Posting API /
 * Business API) and is not surfaced in Login Kit's sandbox scope list.
 * Requesting it would cause "invalid_scope" on the OAuth call. The
 * inline stats on `video.list` cover v1 — followers + per-video counts.
 * If we later need historical daily breakdowns per video, we'd apply
 * for the Business API product as a separate review.
 *
 * All four are SENSITIVE — only listed Sandbox users can grant while
 * the TikTok app is in Sandbox mode. Production rollout needs each
 * scope reviewed by TikTok (typically days, not weeks).
 */

export const TIKTOK_OAUTH_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
] as const;

const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/** Name of the httpOnly cookie that carries the PKCE verifier from the
 *  /start route to /callback. Single source of truth for both routes. */
export const TIKTOK_PKCE_COOKIE = "tiktok_pkce_verifier";

// ─────────────────────────────────────────────────────────────────────────────
// PKCE (Proof Key for Code Exchange) — mandatory for TikTok's web OAuth v2.
//
// Flow: /start generates a random `code_verifier`, derives the
// `code_challenge` from it, sends the challenge to TikTok, and stashes
// the verifier in a short-lived httpOnly cookie. /callback reads the
// verifier back and sends it in the token exchange. TikTok rehashes the
// verifier and confirms it matches the challenge it saw at authorize time.

// Unreserved character set per RFC 7636 §4.1 — the only chars TikTok
// allows in a verifier.
const PKCE_VERIFIER_CHARSET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/**
 * Generate a high-entropy PKCE code_verifier. TikTok requires length
 * 43–128 from the unreserved set; we use 64. A fresh one must be minted
 * for every authorization request.
 */
export function generateCodeVerifier(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PKCE_VERIFIER_CHARSET[bytes[i] % PKCE_VERIFIER_CHARSET.length];
  }
  return out;
}

/**
 * Derive the code_challenge from a verifier.
 *
 * CRITICAL TikTok quirk: the challenge is the HEX string of
 * SHA-256(verifier) — e.g. CryptoJS.SHA256(v).toString(CryptoJS.enc.Hex).
 * Standard RFC 7636 S256 uses base64url; TikTok does NOT. Sending the
 * base64url form gets you a bare "code_challenge" rejection at authorize.
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildAuthUrl(args: {
  clientKey: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_key: args.clientKey,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: "code",
    // TikTok wants scopes as a comma-separated string in a single
    // `scope` param. URLSearchParams handles the URL-encoding of commas.
    scope: TIKTOK_OAUTH_SCOPES.join(","),
    // PKCE — REQUIRED by TikTok's web/desktop OAuth v2 flow. Without
    // these two params the authorize endpoint rejects with a bare
    // "code_challenge" error. TikTok is NON-STANDARD here: the challenge
    // is the HEX encoding of SHA-256(code_verifier), NOT the base64url
    // form that RFC 7636 / most PKCE libraries emit. S256 is the only
    // method TikTok accepts. See deriveCodeChallenge() below.
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    // Force TikTok to show the consent screen even if the same account
    // has previously granted these scopes from this browser session.
    //
    // Without this, TikTok short-circuits: any time the user is logged
    // into TikTok in the same browser AND has authorized this app
    // before, the authorize endpoint silently redirects back with a
    // fresh auth code instead of showing the consent UI. That breaks
    // two flows:
    //   1. The OAuth-review demo (reviewers need to see the consent
    //      screen with all four scopes listed).
    //   2. A client who connected the wrong account can't switch —
    //      Reconnect just silently re-OAuths the same account.
    //
    // `disable_auto_auth=1` is undocumented but widely used (TikTok's
    // own developer relations team has confirmed it on dev support
    // threads). Falls back gracefully if TikTok ever removes it —
    // we'd just be back to the previous auto-reconnect behavior.
    //
    // Note: this still doesn't let users pick a DIFFERENT account from
    // the consent screen — TikTok bakes the account into the session.
    // For account-switching, the user must sign out of tiktok.com
    // first; the admin UI surfaces a direct logout link for that case.
    disable_auto_auth: "1",
  });
  return `${TIKTOK_AUTHORIZE_URL}?${params}`;
}

export async function exchangeCodeForTokens(args: {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  /** The PKCE verifier whose SHA-256 we sent as code_challenge at /start.
   *  TikTok recomputes the challenge from this and rejects the exchange
   *  if it doesn't match. */
  codeVerifier: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
}> {
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body: new URLSearchParams({
      client_key: args.clientKey,
      client_secret: args.clientSecret,
      code: args.code,
      grant_type: "authorization_code",
      redirect_uri: args.redirectUri,
      code_verifier: args.codeVerifier,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TikTok token exchange failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    open_id?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!json.access_token || !json.refresh_token) {
    throw new Error(
      `TikTok token response missing tokens: ${json.error_description ?? json.error ?? "unknown"}`,
    );
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in ?? 86_400,
    refresh_expires_in: json.refresh_expires_in ?? 365 * 86_400,
    open_id: json.open_id ?? "",
    scope: json.scope ?? "",
  };
}

/**
 * Refresh the access_token. TikTok returns a NEW refresh_token here —
 * callers must persist it (overwriting the old one) or the next refresh
 * will fail. We return both so the caller can do the persistence.
 */
export async function refreshAccessToken(args: {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{
  access_token: string;
  refresh_token: string;  // ← NEW one; persist it
  expires_in: number;
}> {
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: args.clientKey,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TikTok refresh failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token) {
    throw new Error("TikTok refresh returned no tokens");
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in ?? 86_400,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State signing — same HMAC pattern as Meta + YouTube. Re-declared so
// each platform can evolve independently.
//
// State carries (clientId, returnTo, timestamp) signed with the TikTok client
// secret as `<clientId>.<returnTo>.<ts>.<hmac-hex>`. `returnTo` ("admin" |
// "socials") records which surface kicked off the connect so the callback can
// land the user back where they started. The verifier still accepts the legacy
// 3-part format (<clientId>.<ts>.<sig>, returnTo defaulted to "admin").

const STATE_TTL_MS = 10 * 60 * 1000;

export type TiktokReturnTo = "admin" | "socials";

export async function signState(args: {
  clientId: string;
  secret: string;
  returnTo?: TiktokReturnTo;
}): Promise<string> {
  const ts = Date.now().toString();
  const returnTo: TiktokReturnTo = args.returnTo ?? "admin";
  const payload = `${args.clientId}.${returnTo}.${ts}`;
  const sig = await hmacHex(args.secret, payload);
  return `${payload}.${sig}`;
}

export type StateVerification =
  | { ok: true; clientId: string; returnTo: TiktokReturnTo }
  | { ok: false; reason: string };

export async function verifyState(args: { state: string; secret: string }): Promise<StateVerification> {
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
  if (sig.length !== expected.length) return { ok: false, reason: "Bad signature" };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "Bad signature" };
  const returnTo: TiktokReturnTo = returnToRaw === "socials" ? "socials" : "admin";
  return { ok: true, clientId, returnTo };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function callbackUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/api/auth/tiktok/callback`;
}
