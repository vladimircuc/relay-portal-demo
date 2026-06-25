/**
 * GET /api/auth/youtube/callback?code=...&state=...
 *
 * Google's redirect target after the user grants (or denies) on the
 * YouTube/Google OAuth consent screen.
 *
 * Flow:
 *   1. Verify state HMAC
 *   2. Exchange code for { access_token, refresh_token } via Google's
 *      token endpoint
 *   3. Use the fresh access_token to fetch the user's selected channel
 *      info (id, name, handle, thumbnail) from YouTube Data API
 *   4. Store the REFRESH TOKEN in vault (it's the long-lived credential
 *      we need for every subsequent API call) and the channel metadata
 *      directly in client_social_credentials
 *
 * Unlike Meta, no per-page picker is needed at our layer — Google's
 * OAuth dialog already shows a "Choose YouTube channel" screen during
 * consent when the user manages multiple channels via Brand Accounts.
 *
 * Re-connect: ON CONFLICT (client_id, platform) rotates the vault
 * secret in place so reconnecting to swap channels is idempotent.
 */
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireClientAccess } from "@/lib/auth";
import { setVaultSecret } from "@/lib/etl/vault";
import { kickSocialBackfill, resolveOrigin } from "@/lib/etl/social-backfill-kick";
import {
  exchangeCodeForTokens,
  verifyState,
  callbackUrlFromRequest,
} from "@/lib/youtube-oauth";

export const runtime = "edge";

type Channel = {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;       // The "@handle" form (without the @)
    thumbnails?: { default?: { url?: string } };
  };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    // User cancelled / denied. Land on /clients with the error visible —
    // we can't extract the slug from state since state wasn't verified.
    redirect(`/clients?youtube_oauth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    return new Response("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not configured", {
      status: 500,
    });
  }

  const verified = await verifyState({ state, secret: googleClientSecret });
  if (!verified.ok) {
    return new Response(`OAuth state rejected: ${verified.reason}`, { status: 400 });
  }
  const clientId = verified.clientId;
  const returnTo = verified.returnTo;

  // Authz: re-assert client access here, mirroring the /start gate.
  // /start already checked, but a replayed or hand-crafted callback would
  // otherwise persist a token for a client the current session can't access.
  // Runs BEFORE the token exchange so an unauthorized hit makes zero outbound
  // API calls. Edge-safe (same helper the /start routes use).
  await requireClientAccess(clientId);

  const redirectUri = callbackUrlFromRequest(request);

  // ── 1) Exchange code for tokens ─────────────────────────────────────────
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri,
      code,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg, { status: 502 });
  }

  // ── 2) Look up the selected channel ─────────────────────────────────────
  // mine=true scopes the query to the channel the OAuth grant covers.
  // If the user picked a Brand Account during consent, mine=true returns
  // THAT channel (not their personal one).
  const channelRes = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?" +
      new URLSearchParams({
        part: "snippet",
        mine: "true",
      }),
    { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" },
  );
  if (!channelRes.ok) {
    const body = await channelRes.text();
    return new Response(`YouTube channels lookup failed: ${body.slice(0, 400)}`, { status: 502 });
  }
  const channelJson = (await channelRes.json()) as { items?: Channel[] };
  const channel = channelJson.items?.[0];
  if (!channel) {
    return new Response(
      "No YouTube channel returned for this account. Make sure the Google " +
        "account that just authorized has at least one YouTube channel.",
      { status: 400 },
    );
  }

  // ── 3) Persist: refresh_token in vault, channel meta in the table ──────
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, youtube_channel_id")
    .eq("client_id", clientId)
    .eq("platform", "youtube")
    .maybeSingle();

  const secretId = await setVaultSecret(supabase, {
    existingId: (existing?.access_token_secret_id as string | undefined) ?? null,
    secretValue: tokens.refresh_token,
    secretName: `youtube_refresh_token__${clientId}__${channel.id}`,
  });

  const { error: upsertErr } = await supabase
    .from("client_social_credentials")
    .upsert(
      {
        client_id: clientId,
        platform: "youtube",
        access_token_secret_id: secretId,
        youtube_channel_id: channel.id,
        youtube_channel_title: channel.snippet?.title ?? null,
        youtube_channel_handle: channel.snippet?.customUrl ?? null,
        youtube_channel_thumbnail: channel.snippet?.thumbnails?.default?.url ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,platform" },
    );
  if (upsertErr) {
    return new Response(`DB upsert failed: ${upsertErr.message}`, { status: 500 });
  }

  // Account-scoped retention (migration 028): if this reconnect points at a
  // DIFFERENT channel, the new channel_id starts a FRESH series — the old
  // channel's metrics/posts stay in place but DORMANT, never deleted — and a
  // backfill is kicked (best-effort) to populate it. A plain re-auth of the
  // same channel already has its data, so we skip the re-backfill. Switching
  // BACK to a previously-connected channel just re-surfaces its rows.
  const channelChanged =
    !existing || (existing.youtube_channel_id as string | null) !== channel.id;
  if (channelChanged) {
    kickSocialBackfill({ origin: resolveOrigin(request.url), clientId, platform: "youtube" });
  }

  const { data: clientRow } = await supabase
    .from("clients")
    .select("slug")
    .eq("id", clientId)
    .maybeSingle();
  const slug = (clientRow?.slug as string | undefined) ?? "";

  // Land back where the connect was launched. The Socials dashboard mounts the
  // SocialBackfillOverlay and arms it on ?youtube_connected=1; the admin page
  // does the same for its inline Social Accounts section.
  redirect(
    returnTo === "socials"
      ? `/${slug}/socials?youtube_connected=1`
      : `/${slug}/admin?youtube_connected=1#social-credentials`,
  );
}
