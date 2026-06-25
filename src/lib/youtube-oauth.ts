/**
 * Helpers for the YouTube (Google) OAuth flow used by the Socials module.
 *
 * Differs from Meta in three important ways:
 *
 *   1. Token model: Google issues a short-lived access_token (~1hr) +
 *      a long-lived refresh_token. The refresh_token is the durable
 *      credential we store; every API call mints a fresh access_token
 *      via refreshAccessToken().
 *
 *   2. Getting a refresh_token requires `access_type=offline` +
 *      `prompt=consent` on the authorization URL. Without prompt=consent
 *      Google may skip issuing a new refresh_token on re-grant, which
 *      breaks reconnect flows. We always send both.
 *
 *   3. Multi-channel picker: Google's OAuth dialog itself shows a
 *      "Choose YouTube channel" screen when the user has access to
 *      multiple channels (e.g. their personal channel + a Brand
 *      Account they manage for a client). We don't need to build a
 *      picker like we did for Meta — Google handles it.
 *
 * Scopes:
 *   - youtube.readonly         — channel metadata, video list
 *   - yt-analytics.readonly    — channel reports (views, watch time,
 *                                subscribers gained, demographics)
 *
 * Both are SENSITIVE scopes. Up to ~100 Test Users can grant while the
 * app is in Testing mode; production rollout requires Google verification.
 */

export const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Build the authorization URL. The user's browser is redirected here
 * when they click "Connect YouTube"; Google then redirects to our
 * `redirectUri` with `?code=...` (success) or `?error=...` (denial).
 */
export function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: "code",
    scope: YOUTUBE_OAUTH_SCOPES.join(" "),
    // Required to receive a refresh_token at all.
    access_type: "offline",
    // `prompt=consent select_account` does TWO things:
    //   1. select_account — Google shows the account picker every time,
    //      even if only one Google account is signed in. Critical for
    //      the "Connect a different account" use case: without this,
    //      Google silently uses whichever Google account is currently
    //      logged in, so a client who picked the wrong account can't
    //      switch without signing out of Google first.
    //   2. consent — Forces the YouTube channel picker (Brand Accounts)
    //      to re-appear, AND guarantees a fresh refresh_token in the
    //      response. Without it, Google may skip both — leaving us with
    //      only a 1hr access_token and no way to renew, and the user
    //      stuck on whichever Brand Account they last picked.
    // The two prompts are space-separated in a single param.
    prompt: "consent select_account",
    include_granted_scopes: "true",
  });
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params}`;
}

/**
 * Exchange the authorization code for an initial access_token +
 * refresh_token pair. Called once from the callback route after the
 * user grants permission.
 */
export async function exchangeCodeForTokens(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token || !json.refresh_token) {
    throw new Error(
      "Google token response missing access_token or refresh_token — " +
        "likely a missing prompt=consent or access_type=offline on the auth URL.",
    );
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in ?? 3600,
    scope: json.scope ?? "",
  };
}

/**
 * Mint a fresh short-lived access_token from a stored refresh_token.
 * Called by the ETL every time it needs to hit a YouTube API endpoint —
 * cheap (~100ms), no point caching at our layer.
 *
 * Throws if Google rejects the refresh_token (revoked, expired, or
 * Testing-mode 7-day window elapsed). Callers should surface this
 * clearly so the user knows to re-grant.
 */
export async function refreshAccessToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google refresh failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google refresh returned no access_token");
  return { access_token: json.access_token, expires_in: json.expires_in ?? 3600 };
}

// ─────────────────────────────────────────────────────────────────────────────
// State signing — same HMAC pattern as Meta. Re-implemented here instead
// of imported from meta-oauth.ts so the two platforms can drift
// independently (e.g. if Google requires a different state shape later).
//
// State carries (clientId, returnTo, timestamp) signed with the Google client
// secret, bundled as `<clientId>.<returnTo>.<ts>.<hmac-hex>`. `returnTo`
// ("admin" | "socials") records which surface kicked off the connect so the
// callback can land the user back where they started. The verifier still
// accepts the legacy 3-part format (<clientId>.<ts>.<sig>, returnTo defaulted
// to "admin") so any connect mid-flight across a deploy doesn't break.

const STATE_TTL_MS = 10 * 60 * 1000;

export type YoutubeReturnTo = "admin" | "socials";

export async function signState(args: {
  clientId: string;
  secret: string;
  returnTo?: YoutubeReturnTo;
}): Promise<string> {
  const ts = Date.now().toString();
  const returnTo: YoutubeReturnTo = args.returnTo ?? "admin";
  const payload = `${args.clientId}.${returnTo}.${ts}`;
  const sig = await hmacHex(args.secret, payload);
  return `${payload}.${sig}`;
}

export type StateVerification =
  | { ok: true; clientId: string; returnTo: YoutubeReturnTo }
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
  if (sig.length !== expected.length) return { ok: false, reason: "Bad signature" };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "Bad signature" };
  const returnTo: YoutubeReturnTo = returnToRaw === "socials" ? "socials" : "admin";
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
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function callbackUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/api/auth/youtube/callback`;
}
