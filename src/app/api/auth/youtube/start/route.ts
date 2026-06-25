/**
 * GET /api/auth/youtube/start?clientId=<uuid>
 *
 * Kick off YouTube (Google) OAuth. Verifies the caller is admin for
 * this client, builds Google's authorization URL with our scopes + a
 * signed state, redirects to accounts.google.com.
 *
 * Google then redirects to /api/auth/youtube/callback with `?code=...`
 * (success) or `?error=...` (denial/cancel).
 */
import { redirect } from "next/navigation";
import { requireClientAccess } from "@/lib/auth";
import {
  buildAuthUrl,
  signState,
  callbackUrlFromRequest,
} from "@/lib/youtube-oauth";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  if (!clientId) return new Response("Missing clientId", { status: 400 });

  await requireClientAccess(clientId);

  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return new Response(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not configured. " +
        "Finish the Google Cloud OAuth client setup and add both values to " +
        ".env.local (local) or Vercel env (production), then retry.",
      { status: 500 },
    );
  }

  // Sign state with the Google client secret — same pattern as Meta uses
  // its app secret. Verifies on callback that we issued the state. `returnTo`
  // rides along so the callback can land the user back on the surface that
  // launched the connect (the Socials dashboard vs the admin page).
  const returnTo = url.searchParams.get("returnTo") === "socials" ? "socials" : "admin";
  const state = await signState({ clientId, secret: googleClientSecret, returnTo });
  const authUrl = buildAuthUrl({
    clientId: googleClientId,
    redirectUri: callbackUrlFromRequest(request),
    state,
  });

  redirect(authUrl);
}
