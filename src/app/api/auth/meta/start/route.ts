/**
 * GET /api/auth/meta/start?clientId=<uuid>
 *
 * Kicks off the Facebook Login for Business OAuth flow used by the
 * Socials module. The "Connect Facebook + Instagram" button on
 * /<slug>/admin links here; we authorize the caller, build the OAuth
 * dialog URL with our App ID + scopes + a signed state, and redirect
 * the browser to facebook.com.
 *
 * Flow:
 *   1. Verify the caller can access this client (so a random user
 *      can't trigger an OAuth grant on someone else's client).
 *   2. Sign a state token that carries the clientId + a timestamp
 *      (HMAC with META_APP_SECRET — the callback verifies it).
 *   3. Redirect to Meta's OAuth dialog.
 *
 * Meta will redirect back to /api/auth/meta/callback with `?code=...`
 * (success) or `?error=...` (denial/cancel) plus our state echoed back.
 */
import { redirect } from "next/navigation";
import { requireClientAccess } from "@/lib/auth";
import {
  buildOAuthDialogUrl,
  signState,
  callbackUrlFromRequest,
} from "@/lib/meta-oauth";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  if (!clientId) {
    return new Response("Missing clientId", { status: 400 });
  }

  // Auth: anyone who can VIEW this client can initiate a connect — viewers
  // included (self-serve socials connection). Throws on denial → 500, fine for
  // an OAuth entrypoint. The signed `state` below still binds the grant to this
  // clientId, so the callback can't be repointed at another client.
  await requireClientAccess(clientId);

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return new Response(
      "META_APP_ID / META_APP_SECRET not configured. Add them to .env.local " +
        "(local) or the Vercel environment (production) before using the " +
        "Socials connect flow.",
      { status: 500 },
    );
  }

  // Where to land after the page-picker completes: the Socials dashboard's
  // connect modal (when launched from there) or the admin Credentials page
  // (default / non-Varble clients). Anything other than "socials" → admin.
  const returnTo = url.searchParams.get("returnTo") === "socials" ? "socials" : "admin";

  const state = await signState({ clientId, secret: appSecret, returnTo });
  const dialogUrl = buildOAuthDialogUrl({
    appId,
    redirectUri: callbackUrlFromRequest(request),
    state,
  });

  // Next's redirect() throws NEXT_REDIRECT — caught by the framework
  // and turned into a 307. Same as form-action redirects elsewhere.
  redirect(dialogUrl);
}
