/**
 * GET /api/auth/meta/callback?code=...&state=...
 *
 * The redirect target Meta hits after the user grants (or denies)
 * permissions on the Facebook OAuth dialog. Does the token exchange +
 * page discovery, then **stages** the result for the admin to pick
 * which Page corresponds to this client — Meta's OAuth doesn't
 * surface a reliable picker for Business Login when the user manages
 * multiple Pages, so we run our own.
 *
 * Token exchange chain:
 *   1. code (short-lived, single-use)        →
 *   2. short-lived USER access token (~1hr)  →
 *   3. long-lived USER access token (~60 days)
 *   4. /me/accounts → per-Page access tokens (long-lived when (3) is)
 *
 * Page tokens (not the user token) are what we'd ultimately persist —
 * page tokens are scoped to a single Page and never expire as long as
 * the admin remains an admin on the Page.
 *
 * Staging strategy: we serialize the full pages list (each entry
 * includes its page access token + linked IG account) as a SINGLE
 * JSON blob into vault.secrets (encrypted at rest), and drop the
 * vault secret_id into a short-lived httpOnly cookie. The admin
 * landing page reads the cookie, fetches + parses the blob, and
 * renders a picker. Once the admin picks, a server action promotes
 * the chosen page's token to a permanent vault secret + writes the
 * client_social_credentials row, then deletes the staging secret.
 *
 * Why vault for staging (instead of a temp table or session storage):
 *   - Page tokens are sensitive — vault gives encryption at rest +
 *     the same access-control surface as production secrets
 *   - No schema change required to support deferred picking
 *   - Cookie holds only the secret_id (a UUID); the tokens never
 *     touch the user's browser or our request logs
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { requireClientAccess } from "@/lib/auth";
import { setVaultSecret } from "@/lib/etl/vault";
import {
  META_API_VERSION,
  verifyState,
  callbackUrlFromRequest,
} from "@/lib/meta-oauth";

/** Cookie that holds the staging vault secret_id between OAuth callback
 *  and the admin picker. httpOnly, samesite=lax, 10-min lifespan. */
export const META_PENDING_COOKIE = "ps_meta_oauth_pending";
const PENDING_COOKIE_MAX_AGE = 600; // 10 minutes

export const runtime = "edge";

/** Shape of Meta's /me/accounts response when we request the fields below. */
type MeAccountsRow = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: {
    id: string;
    username?: string;
  };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // User denied / cancelled — bounce back to wherever they came from
  // with an error flag. We can't recover the clientId from a denied
  // state (Meta echoes state but we didn't generate it for an error
  // path), so the best we can do is land on /clients.
  if (error) {
    redirect(`/clients?meta_oauth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return new Response("META_APP_ID / META_APP_SECRET not configured", { status: 500 });
  }

  const verified = await verifyState({ state, secret: appSecret });
  if (!verified.ok) {
    return new Response(`OAuth state rejected: ${verified.reason}`, { status: 400 });
  }
  const clientId = verified.clientId;
  const returnTo = verified.returnTo;

  // Authz: re-assert client access here, mirroring the /start gate and the other
  // three social callbacks. /start already checked, but a replayed or hand-crafted
  // (still-valid) state would otherwise stage page tokens against a client the
  // current session can't access. Runs BEFORE the token exchange so an
  // unauthorized hit makes zero outbound Graph API calls. Edge-safe.
  await requireClientAccess(clientId);

  const redirectUri = callbackUrlFromRequest(request);

  // ── 1) Exchange code → short-lived user token ───────────────────────────
  const shortRes = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      }),
  );
  if (!shortRes.ok) {
    const body = await shortRes.text();
    return new Response(`Code exchange failed: ${body.slice(0, 400)}`, { status: 502 });
  }
  const shortJson = (await shortRes.json()) as { access_token?: string };
  if (!shortJson.access_token) {
    return new Response("No access_token in code-exchange response", { status: 502 });
  }

  // ── 2) Upgrade to long-lived user token (~60 days) ──────────────────────
  const longRes = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortJson.access_token,
      }),
  );
  if (!longRes.ok) {
    const body = await longRes.text();
    return new Response(`Long-lived exchange failed: ${body.slice(0, 400)}`, { status: 502 });
  }
  const longJson = (await longRes.json()) as { access_token?: string };
  const longUserToken = longJson.access_token;
  if (!longUserToken) {
    return new Response("No access_token in long-lived response", { status: 502 });
  }

  // ── 3) List the user's pages, with linked IG account in one roundtrip ──
  const accountsRes = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/me/accounts?` +
      new URLSearchParams({
        access_token: longUserToken,
        fields: "id,name,access_token,instagram_business_account{id,username}",
        limit: "100",
      }),
  );
  if (!accountsRes.ok) {
    const body = await accountsRes.text();
    return new Response(`/me/accounts failed: ${body.slice(0, 400)}`, { status: 502 });
  }
  const accountsJson = (await accountsRes.json()) as { data?: MeAccountsRow[] };
  const pages = accountsJson.data ?? [];
  if (pages.length === 0) {
    return new Response(
      "No Facebook Pages were returned. The signed-in user must be an admin " +
        "on at least one Page (in Meta Business Manager → Pages) for this " +
        "flow to work.",
      { status: 400 },
    );
  }

  // ── 4) Stage the pages in vault + drop a cookie pointing at them ──────
  const supabase = createAdminClient();

  // Serialize the full pages list — page id, name, page access token, and
  // the linked IG (if any). Vault encrypts the value at rest. We use a
  // disposable secret name (includes timestamp) since this row is
  // ephemeral.
  const stagingPayload = JSON.stringify(
    pages.map((p) => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
      ig_user_id: p.instagram_business_account?.id ?? null,
      ig_username: p.instagram_business_account?.username ?? null,
    })),
  );
  const stagingSecretId = await setVaultSecret(supabase, {
    existingId: null,
    secretValue: stagingPayload,
    secretName: `meta_oauth_pending__${clientId}__${Date.now()}`,
  });

  // httpOnly cookie so the page tokens never get embedded in URLs /
  // referrer headers / browser-visible storage. Lax sameSite so it
  // survives the redirect back from facebook.com.
  const cookieStore = await cookies();
  cookieStore.set(META_PENDING_COOKIE, stagingSecretId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_COOKIE_MAX_AGE,
  });

  // Find the slug so we can land on the right admin page.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("slug")
    .eq("id", clientId)
    .maybeSingle();
  const slug = (clientRow?.slug as string | undefined) ?? "";

  // Land back where the connect was launched. The Socials dashboard reads
  // ?meta_picker=1 to auto-open the connect modal (which shows the picker
  // since the pending cookie is set); the admin page reads it the same way
  // for its inline Social Accounts section.
  redirect(
    returnTo === "socials"
      ? `/${slug}/socials?meta_picker=1`
      : `/${slug}/admin?meta_picker=1#social-credentials`,
  );
}
