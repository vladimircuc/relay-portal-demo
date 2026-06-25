/**
 * GET /api/auth/tiktok/callback?code=...&state=...
 *
 * TikTok's redirect target after consent. Verifies state, exchanges the
 * code for { access_token, refresh_token, open_id }, fetches the user's
 * profile + stats so we can display them in the admin UI, persists.
 *
 * Storage:
 *   - refresh_token → vault (durable credential; access_tokens get
 *     minted from it each ETL run)
 *   - open_id / union_id / display_name / username / avatar →
 *     client_social_credentials.tiktok_* columns
 *
 * Re-connect rotates the vault secret + overwrites the row.
 */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { requireClientAccess } from "@/lib/auth";
import { setVaultSecret } from "@/lib/etl/vault";
import { kickSocialBackfill, resolveOrigin } from "@/lib/etl/social-backfill-kick";
import {
  exchangeCodeForTokens,
  verifyState,
  callbackUrlFromRequest,
  TIKTOK_PKCE_COOKIE,
} from "@/lib/tiktok-oauth";

export const runtime = "edge";

type UserInfoResponse = {
  data?: {
    user?: {
      open_id?: string;
      union_id?: string;
      avatar_url?: string;
      display_name?: string;
      username?: string;
      bio_description?: string;
      follower_count?: number;
      following_count?: number;
      likes_count?: number;
      video_count?: number;
    };
  };
  error?: { code?: string; message?: string };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    redirect(`/clients?tiktok_oauth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    return new Response("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not configured", { status: 500 });
  }

  const verified = await verifyState({ state, secret: clientSecret });
  if (!verified.ok) return new Response(`OAuth state rejected: ${verified.reason}`, { status: 400 });
  const clientId = verified.clientId;
  const returnTo = verified.returnTo;

  // Authz: re-assert client access here, mirroring the /start gate.
  // /start already checked, but a replayed or hand-crafted callback would
  // otherwise persist a token for a client the current session can't access.
  // Runs BEFORE the token exchange so an unauthorized hit makes zero outbound
  // API calls. Edge-safe (same helper the /start routes use).
  await requireClientAccess(clientId);

  const redirectUri = callbackUrlFromRequest(request);

  // PKCE: pull the verifier we stashed at /start. TikTok rehashes it and
  // rejects the exchange unless it matches the challenge it saw earlier.
  const cookieStore = await cookies();
  const codeVerifier = cookieStore.get(TIKTOK_PKCE_COOKIE)?.value;
  if (!codeVerifier) {
    return new Response(
      "TikTok PKCE verifier missing or expired. This usually means the " +
        "connect link sat too long (>10 min) or cookies were blocked. " +
        "Please start the TikTok connect flow again from Settings.",
      { status: 400 },
    );
  }

  // ── 1) Token exchange ──────────────────────────────────────────────────
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ clientKey, clientSecret, redirectUri, code, codeVerifier });
  } catch (e) {
    const errorId = crypto.randomUUID();
    console.error(`[auth/tiktok/callback] token exchange failed (errorId=${errorId})`, e);
    return new Response(`Token exchange failed (ref ${errorId})`, { status: 502 });
  }

  // ── 2) Fetch profile metadata for display ──────────────────────────────
  // /v2/user/info/ returns the connected user's basic profile + stats.
  // Field list determines what comes back — request the ones we'd show
  // in the admin UI (and that match the user.info.* scopes we requested).
  const userFields = [
    "open_id", "union_id", "avatar_url", "display_name",
    "username", "bio_description",
    "follower_count", "following_count", "likes_count", "video_count",
  ].join(",");
  const infoRes = await fetch(
    `https://open.tiktokapis.com/v2/user/info/?fields=${userFields}`,
    { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" },
  );
  if (!infoRes.ok) {
    const body = await infoRes.text();
    return new Response(`TikTok user/info failed: ${body.slice(0, 400)}`, { status: 502 });
  }
  // /v2/user/info/ may be sparse; the token exchange also returns open_id, so
  // `openId` below falls back to tokens.open_id to keep the row insertable.
  const info = ((await infoRes.json()) as UserInfoResponse).data?.user;

  // ── 3) Persist ─────────────────────────────────────────────────────────
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, tiktok_open_id")
    .eq("client_id", clientId).eq("platform", "tiktok").maybeSingle();

  const openId = info?.open_id ?? tokens.open_id ?? null;

  const secretId = await setVaultSecret(supabase, {
    existingId: (existing?.access_token_secret_id as string | undefined) ?? null,
    secretValue: tokens.refresh_token,
    secretName: `tiktok_refresh_token__${clientId}__${openId || "unknown"}`,
  });

  const { error: upsertErr } = await supabase
    .from("client_social_credentials")
    .upsert(
      {
        client_id: clientId,
        platform: "tiktok",
        access_token_secret_id: secretId,
        tiktok_open_id: openId,
        tiktok_union_id: info?.union_id ?? null,
        tiktok_username: info?.username ?? null,
        tiktok_display_name: info?.display_name ?? null,
        tiktok_avatar_url: info?.avatar_url ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,platform" },
    );
  if (upsertErr) return new Response(`DB upsert failed: ${upsertErr.message}`, { status: 500 });

  // Account-scoped retention (migration 028): connecting a DIFFERENT TikTok
  // account (open_id differs) starts a FRESH series keyed by the new open_id —
  // the old account's history (incl. its irreplaceable daily follower snapshots,
  // TikTok has no historical API) stays in place but DORMANT, never deleted —
  // and a backfill is kicked (best-effort) to populate the new account. A
  // same-account re-auth already has its data, so we skip the re-backfill.
  // Switching BACK to a previously-connected account just re-surfaces its rows.
  const accountChanged = !existing || (existing.tiktok_open_id as string | null) !== openId;
  if (accountChanged) {
    kickSocialBackfill({ origin: resolveOrigin(request.url), clientId, platform: "tiktok" });
  }

  const { data: clientRow } = await supabase
    .from("clients").select("slug").eq("id", clientId).maybeSingle();
  const slug = (clientRow?.slug as string | undefined) ?? "";

  // Land back where the connect was launched. The Socials dashboard mounts the
  // SocialBackfillOverlay and arms it on ?tiktok_connected=1; the admin page
  // does the same for its inline Social Accounts section.
  redirect(
    returnTo === "socials"
      ? `/${slug}/socials?tiktok_connected=1`
      : `/${slug}/admin?tiktok_connected=1#social-credentials`,
  );
}
