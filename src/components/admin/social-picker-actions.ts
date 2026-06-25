"use server";

/**
 * Server actions for the Meta OAuth page-picker flow.
 *
 * Flow:
 *   1. User clicks "Connect Facebook + Instagram" → OAuth redirects to
 *      /api/auth/meta/callback
 *   2. Callback stages ALL the user's Pages (with page tokens + linked
 *      IG accounts) into a single vault secret, drops the secret_id
 *      into the `ps_meta_oauth_pending` httpOnly cookie, redirects to
 *      /<slug>/admin?meta_picker=1
 *   3. The Social Accounts admin section sees the cookie + renders a
 *      picker listing every staged Page
 *   4. User clicks "Use this Page" on one → THIS server action runs:
 *        - Pulls the staging JSON from vault
 *        - Promotes the chosen page's token to a permanent vault secret
 *        - Upserts client_social_credentials
 *        - Deletes the staging secret + the cookie
 *
 * Why a server action instead of another GET route: the picker is
 * inherently a user-driven choice, server actions hook into <form>
 * naturally + give us CSRF protection for free.
 */
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { SOCIAL_CACHE_TAG } from "@/lib/socials-timeseries";
import {
  setVaultSecret,
  getVaultSecret,
  deleteVaultSecret,
} from "@/lib/etl/vault";
import { requireClientAccess } from "@/lib/auth";
import { kickSocialBackfill, resolveOrigin } from "@/lib/etl/social-backfill-kick";
import type { SocialPlatform } from "@/lib/etl/social";
import { META_PENDING_COOKIE } from "@/app/api/auth/meta/callback/route";
import { assertWritable } from "@/lib/demo";

type StagedPage = {
  id: string;
  name: string;
  access_token: string;
  ig_user_id: string | null;
  ig_username: string | null;
};

export async function selectMetaPage(formData: FormData): Promise<void> {
  assertWritable("Select Meta Page");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  const fbPageId = String(formData.get("fbPageId") ?? "");
  if (!clientId || !clientSlug || !fbPageId) {
    throw new Error("Missing clientId / clientSlug / fbPageId");
  }
  // Which surface launched the connect — drives where we land after upsert.
  const returnTo = String(formData.get("returnTo") ?? "admin") === "socials" ? "socials" : "admin";
  await requireClientAccess(clientId);

  const cookieStore = await cookies();
  const stagingSecretId = cookieStore.get(META_PENDING_COOKIE)?.value;
  if (!stagingSecretId) {
    throw new Error(
      "No pending Meta connection cookie found. The picker session expired " +
        "(10 minutes). Click 'Connect Facebook + Instagram' again to retry.",
    );
  }

  const supabase = createAdminClient();

  // Pull and parse the staging blob.
  const stagedJson = await getVaultSecret(supabase, stagingSecretId);
  const pages = JSON.parse(stagedJson) as StagedPage[];
  const picked = pages.find((p) => p.id === fbPageId);
  if (!picked) {
    throw new Error(
      `Picked Page ${fbPageId} isn't in the staged list — it may have been ` +
        "removed since you authorized. Click Reconnect to start over.",
    );
  }

  // Promote the chosen page's token to a permanent vault secret.
  // Reuse the existing slot if a row already exists for this client (i.e.
  // a Reconnect / switch-Page flow) so we don't leak orphaned secrets.
  const { data: existing } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, fb_page_id, ig_user_id")
    .eq("client_id", clientId)
    .eq("platform", "meta")
    .maybeSingle();

  const permanentSecretId = await setVaultSecret(supabase, {
    existingId: (existing?.access_token_secret_id as string | undefined) ?? null,
    secretValue: picked.access_token,
    secretName: `meta_page_token__${clientId}__${picked.id}`,
  });

  const { error: upsertErr } = await supabase
    .from("client_social_credentials")
    .upsert(
      {
        client_id: clientId,
        platform: "meta",
        access_token_secret_id: permanentSecretId,
        fb_page_id: picked.id,
        fb_page_name: picked.name,
        ig_user_id: picked.ig_user_id,
        ig_username: picked.ig_username,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,platform" },
    );
  if (upsertErr) {
    throw new Error(`DB upsert failed: ${upsertErr.message}`);
  }

  // Cleanup: delete the staging secret + clear the cookie so the picker
  // disappears on the next render.
  await deleteVaultSecret(supabase, stagingSecretId);
  cookieStore.delete(META_PENDING_COOKIE);

  // Account-scoped retention (migration 028): if the chosen Page (or its linked
  // IG account) differs from what was stored, the new account_id (fb_page_id /
  // ig_user_id) starts a FRESH series — the old account's metrics/posts stay in
  // place but DORMANT, never deleted, and can't bleed into the new account since
  // reads scope to the active id. A backfill is kicked (best-effort) to populate
  // the new account; a plain token reconnect to the SAME Page already has its
  // data, so we skip it. The two Meta platforms get separate kicks so IG's slow
  // ~3.5min pull is its own Node invocation. meta_facebook covers FB;
  // meta_instagram is implicated whenever the Page changes (the IG link rides on
  // the Page) or the IG id itself changed — including an unlink (ig_user_id →
  // null): runSocialBackfill simply no-ops IG when there's no id, and the old IG
  // series goes dormant since it's no longer the active account.
  const oldFb = (existing?.fb_page_id as string | null | undefined) ?? null;
  const oldIg = (existing?.ig_user_id as string | null | undefined) ?? null;
  const fbChanged = !existing || oldFb !== picked.id;
  const igChanged = oldIg !== (picked.ig_user_id ?? null);
  const changed: SocialPlatform[] = [];
  if (fbChanged) changed.push("meta_facebook");
  if (fbChanged || igChanged) changed.push("meta_instagram");
  if (changed.length > 0) {
    const origin = resolveOrigin();
    for (const platform of changed) kickSocialBackfill({ origin, clientId, platform });
  }

  // Bust the socials read cache now. The cache is keyed by (clientId, range),
  // NOT by account — so a switch to a different Page / IG account wouldn't
  // change the key, and the dashboard could keep serving the previous account's
  // cached numbers until the TTL lapsed. (A backfill for the new account is
  // kicked above; this clears the read cache immediately so the next render
  // recomputes under the new scope.) { expire: 0 } = HARD purge so the switch
  // can't serve one last blob of the previous account's numbers.
  revalidateTag(SOCIAL_CACHE_TAG, { expire: 0 });

  if (returnTo === "socials") {
    revalidatePath(`/${clientSlug}/socials`);
    redirect(`/${clientSlug}/socials?meta_connected=1`);
  }
  revalidatePath(`/${clientSlug}/admin`);
  redirect(`/${clientSlug}/admin?meta_connected=1#social-credentials`);
}

/**
 * Discard a pending OAuth without picking a Page — e.g. the user
 * realised they connected the wrong FB account and wants to start over.
 * Deletes the staging vault secret + clears the cookie.
 */
export async function cancelMetaPicker(formData: FormData): Promise<void> {
  assertWritable("Cancel Meta picker");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing clientId / clientSlug");
  const returnTo = String(formData.get("returnTo") ?? "admin") === "socials" ? "socials" : "admin";
  await requireClientAccess(clientId);

  const cookieStore = await cookies();
  const stagingSecretId = cookieStore.get(META_PENDING_COOKIE)?.value;
  if (stagingSecretId) {
    const supabase = createAdminClient();
    try {
      await deleteVaultSecret(supabase, stagingSecretId);
    } catch {
      // Best-effort cleanup; if the secret's already gone we don't care.
    }
    cookieStore.delete(META_PENDING_COOKIE);
  }
  if (returnTo === "socials") {
    revalidatePath(`/${clientSlug}/socials`);
    redirect(`/${clientSlug}/socials`);
  }
  revalidatePath(`/${clientSlug}/admin`);
  redirect(`/${clientSlug}/admin#social-credentials`);
}
