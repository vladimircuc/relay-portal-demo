/**
 * Helpers for LinkedIn's OAuth 2.0 flow used by the Socials module.
 *
 * Permission tiers + scopes:
 *
 *   Standard tier (no review): `r_liteprofile`, `r_emailaddress` —
 *     personal-profile reads only. Doesn't give us anything we need.
 *
 *   Marketing Developer Platform (Community Management API):
 *     `r_organization_social`     — read org posts, comments, follower stats
 *     `r_organization_followers`  — follower count + demographics
 *     `r_1st_connections_size`    — not relevant
 *     `w_organization_social`     — post on behalf of org (not asking for it
 *                                   here; we're read-only for the dashboard)
 *
 *   The Community Management API requires Standard Tier access, which
 *   needs a Microsoft review (typically 1–2 weeks). Until that's
 *   approved, OAuth grants succeed but API calls return 403.
 *
 * Token model:
 *   - access_token: 60 days
 *   - refresh_token: 365 days (refresh is allowed up to 1 year of
 *     inactivity)
 *
 * We store the refresh_token in vault (it's the durable credential).
 */

export const LINKEDIN_OAUTH_SCOPES = [
  "r_organization_social",
  "r_organization_followers",
  "r_basicprofile",       // who's granting (useful for the picker UI)
] as const;

const LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

export function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    // LinkedIn wants scopes space-separated. URLSearchParams encodes
    // the space as %20 — both forms are accepted.
    scope: LINKEDIN_OAUTH_SCOPES.join(" "),
  });
  return `${LINKEDIN_AUTHORIZE_URL}?${params}`;
}

export async function exchangeCodeForTokens(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in: number;
  scope: string;
}> {
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn token exchange failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) {
    throw new Error("LinkedIn token response missing access_token");
  }
  // LinkedIn only issues refresh tokens to apps that have been granted
  // them in app config — for apps without refresh enabled, we get just
  // the 60-day access_token. Surface clearly if absent.
  if (!json.refresh_token) {
    throw new Error(
      "LinkedIn token response missing refresh_token. Enable refresh tokens " +
        "in the LinkedIn app config (Auth → 'Refresh token enabled') and re-grant.",
    );
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in ?? 60 * 86_400,
    refresh_token_expires_in: json.refresh_token_expires_in ?? 365 * 86_400,
    scope: json.scope ?? "",
  };
}

export async function refreshAccessToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn refresh failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) throw new Error("LinkedIn refresh returned no access_token");
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token, // may or may not rotate; callers persist if present
    expires_in: json.expires_in ?? 60 * 86_400,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State signing

const STATE_TTL_MS = 10 * 60 * 1000;

export async function signState(args: { clientId: string; secret: string }): Promise<string> {
  const ts = Date.now().toString();
  const payload = `${args.clientId}.${ts}`;
  const sig = await hmacHex(args.secret, payload);
  return `${payload}.${sig}`;
}

export type StateVerification =
  | { ok: true; clientId: string }
  | { ok: false; reason: string };

export async function verifyState(args: { state: string; secret: string }): Promise<StateVerification> {
  const parts = args.state.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Malformed state" };
  const [clientId, tsStr, sig] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, reason: "Bad timestamp" };
  if (Date.now() - ts > STATE_TTL_MS) {
    return { ok: false, reason: "State expired — please retry the connect flow" };
  }
  const expected = await hmacHex(args.secret, `${clientId}.${tsStr}`);
  if (sig.length !== expected.length) return { ok: false, reason: "Bad signature" };
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "Bad signature" };
  return { ok: true, clientId };
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
  return `${url.origin}/api/auth/linkedin/callback`;
}
