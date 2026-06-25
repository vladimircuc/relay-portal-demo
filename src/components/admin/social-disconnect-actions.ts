"use server";

/**
 * Server actions for disconnecting a social platform connection from a
 * client. One action shared across all platforms (Meta / YouTube /
 * TikTok / LinkedIn) — the work is identical: delete the vault secret,
 * delete the credential row, revalidate the admin page.
 *
 * Why a server action (vs an API route per the long-running-ops
 * convention): this is purely a DB mutation — no external API calls,
 * no platform-side revocation, runs in <500ms. The convention only
 * routes long external-API work to /api/* endpoints.
 *
 * IMPORTANT — platform-side OAuth grant is NOT revoked by this action.
 * We only clear OUR state. The user (or their TikTok / Google / Meta
 * account) still has the app authorized on the platform side. That's
 * intentional — we don't want to silently revoke the user's choice on
 * a third-party platform from our agency-operator UI. If a client wants
 * to fully sever the connection (e.g. quit the agency), they revoke us
 * from the platform's own "Connected apps" settings. The "Switching
 * accounts" guidance in the admin UI explains this for the common case
 * where a client picked the wrong account and needs to swap.
 */
import { revalidatePath, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { deleteVaultSecret } from "@/lib/etl/vault";
import { requireClientAccess } from "@/lib/auth";
import { SOCIAL_CACHE_TAG } from "@/lib/socials-timeseries";
import { assertWritable } from "@/lib/demo";

type Platform = "meta" | "youtube" | "tiktok" | "linkedin";

const ALLOWED: ReadonlySet<Platform> = new Set(["meta", "youtube", "tiktok", "linkedin"]);

export async function disconnectSocial(formData: FormData): Promise<void> {
  assertWritable("Disconnect account");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  const platform = String(formData.get("platform") ?? "") as Platform;

  if (!clientId || !clientSlug || !platform) {
    throw new Error("disconnectSocial: missing clientId / clientSlug / platform");
  }
  if (!ALLOWED.has(platform)) {
    throw new Error(`disconnectSocial: unknown platform "${platform}"`);
  }

  // Client-access gate — anyone who can VIEW this client can disconnect what
  // they (or a teammate) connected: super-admins, browse admins, and the
  // client's own users (viewers included). Only users with no access to this
  // client get a 403. Mirrors the self-serve connect flow.
  await requireClientAccess(clientId);

  const supabase = createAdminClient();

  // Find the credential row so we can pull the secret UUID before deleting.
  // Doing the read-then-delete dance (instead of a single delete returning
  // values) so we get a clear error if the row's gone — vs silently no-op'ing.
  const { data: row, error: readErr } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id")
    .eq("client_id", clientId)
    .eq("platform", platform)
    .maybeSingle();

  if (readErr) {
    throw new Error(`disconnectSocial: failed to read credential row — ${readErr.message}`);
  }
  if (!row) {
    // Already disconnected — revalidate and return so the UI catches up.
    revalidatePath(`/${clientSlug}/admin`);
    return;
  }

  const secretId = (row as { access_token_secret_id: string | null }).access_token_secret_id;

  // 1. Delete the vault secret first. If this fails we abort — better
  //    to leave a credential row + orphaned-secret-id than a row pointing
  //    at a deleted secret (which would silently fail every future ETL).
  if (secretId) {
    try {
      await deleteVaultSecret(supabase, secretId);
    } catch (e) {
      throw new Error(
        `disconnectSocial: vault delete failed for ${platform} (secret ${secretId}) — ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  // 2. Delete the credential row. Once this lands the platform shows
  //    as not-connected on the admin page.
  const { error: deleteErr } = await supabase
    .from("client_social_credentials")
    .delete()
    .eq("client_id", clientId)
    .eq("platform", platform);

  if (deleteErr) {
    throw new Error(
      `disconnectSocial: row delete failed for ${platform} — ${deleteErr.message}`,
    );
  }

  // 3. Bust the socials read cache (keyed by clientId+range, not account) so
  //    the just-disconnected platform's numbers stop showing, then revalidate
  //    the admin page so the connect/disconnect state flips on next render.
  //    { expire: 0 } = HARD purge so the disconnected account's cached numbers
  //    don't linger for one last stale-while-revalidate render.
  revalidateTag(SOCIAL_CACHE_TAG, { expire: 0 });
  revalidatePath(`/${clientSlug}/admin`);
}
