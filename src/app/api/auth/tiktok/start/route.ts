/**
 * GET /api/auth/tiktok/start?clientId=<uuid>
 *
 * Kick off TikTok OAuth v2. Authorizes the caller, mints a PKCE
 * code_verifier (stashed in a short-lived httpOnly cookie), builds the
 * TikTok authorization URL with our scopes + a signed state + the PKCE
 * code_challenge, then redirects to tiktok.com.
 *
 * PKCE is REQUIRED by TikTok's web flow — see lib/tiktok-oauth.ts. The
 * verifier never leaves our server except as the cookie the browser
 * hands back to /callback; only its SHA-256 (the challenge) goes to
 * TikTok.
 */
import { NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/auth";
import {
  buildAuthUrl,
  signState,
  generateCodeVerifier,
  deriveCodeChallenge,
  callbackUrlFromRequest,
  TIKTOK_PKCE_COOKIE,
} from "@/lib/tiktok-oauth";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  if (!clientId) return new Response("Missing clientId", { status: 400 });

  await requireClientAccess(clientId);

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    return new Response(
      "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not configured. Finish the " +
        "TikTok Developer portal setup and add both to .env.local (or Vercel " +
        "env for prod), then retry.",
      { status: 500 },
    );
  }

  // `returnTo` rides along in the signed state so the callback can land the
  // user back on the surface that launched the connect (Socials vs admin).
  const returnTo = url.searchParams.get("returnTo") === "socials" ? "socials" : "admin";
  const state = await signState({ clientId, secret: clientSecret, returnTo });

  // PKCE: fresh verifier per request; only its hex SHA-256 goes to TikTok.
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await deriveCodeChallenge(codeVerifier);

  const authUrl = buildAuthUrl({
    clientKey,
    redirectUri: callbackUrlFromRequest(request),
    state,
    codeChallenge,
  });

  // Stash the verifier in an httpOnly cookie so /callback can complete the
  // exchange. SameSite=Lax so it survives TikTok's top-level GET redirect
  // back to us (Strict would drop it — the navigation originates off-site).
  // secure only over https so localhost (http) still works.
  const isHttps =
    url.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(TIKTOK_PKCE_COOKIE, codeVerifier, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min — matches the signed-state TTL
  });
  return res;
}
