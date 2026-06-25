"use server";

/**
 * Server actions for the per-client Credentials section.
 *
 * Saves Meta and GHL credentials independently — each card has its own
 * "Save" button. Token fields use Supabase Vault: if the user leaves the
 * token input empty, we DON'T touch the existing vault secret (so they can
 * update the ad account ID without re-entering the token). Typing a value
 * either creates a new secret (first time) or updates the existing one
 * in place; either way the same UUID stays in client_credentials.
 *
 * A separate "Clear" action removes ALL credentials for one source —
 * useful when offboarding a client or rotating after a leak. It deletes
 * the vault secret AND blanks out the non-secret config columns.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireScopeForClient } from "@/lib/auth";
import { setVaultSecret, deleteVaultSecret } from "@/lib/etl/vault";
import { assertWritable } from "@/lib/demo";

function emptyToNull(s: string | null): string | null {
  if (s === null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

/** Normalize a Meta ad account ID to the canonical "act_XXXX" form. */
function normalizeMetaAdAccountId(raw: string): string | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  return cleaned.startsWith("act_") ? cleaned : `act_${cleaned}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta

export async function saveMetaCredentials(formData: FormData): Promise<void> {
  assertWritable("Save Meta credentials");

  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  const token = String(formData.get("token") ?? "");
  const adAccountIdRaw = String(formData.get("adAccountId") ?? "");
  const resultTypeRaw = String(formData.get("resultType") ?? "");

  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const adAccountId = normalizeMetaAdAccountId(adAccountIdRaw);
  const resultType = emptyToNull(resultTypeRaw) ?? "lead";

  const supabase = createAdminClient();

  // Look up the existing row (if any) — we need the current secret_id so
  // we know whether to create or update the vault secret.
  const { data: existing } = await supabase
    .from("client_credentials")
    .select("meta_access_token_secret_id")
    .eq("client_id", clientId)
    .maybeSingle();

  let secretId: string | null = existing?.meta_access_token_secret_id ?? null;

  // Only touch the vault if the admin actually typed a new token.
  if (token.trim() !== "") {
    secretId = await setVaultSecret(supabase, {
      existingId: secretId,
      secretValue: token.trim(),
      secretName: `meta_token__${clientSlug}`,
    });
  }

  const { error } = await supabase
    .from("client_credentials")
    .upsert(
      {
        client_id: clientId,
        meta_access_token_secret_id: secretId,
        meta_ad_account_id: adAccountId,
        meta_result_type: resultType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
}

export async function clearMetaCredentials(formData: FormData): Promise<void> {
  assertWritable("Clear Meta credentials");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("client_credentials")
    .select("meta_access_token_secret_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing?.meta_access_token_secret_id) {
    await deleteVaultSecret(supabase, existing.meta_access_token_secret_id);
  }

  const { error } = await supabase
    .from("client_credentials")
    .upsert(
      {
        client_id: clientId,
        meta_access_token_secret_id: null,
        meta_ad_account_id: null,
        meta_result_type: "lead",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GHL

export async function saveGhlCredentials(formData: FormData): Promise<void> {
  assertWritable("Save Asera credentials");

  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  const token = String(formData.get("token") ?? "");
  const locationId = emptyToNull(String(formData.get("locationId") ?? ""));

  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const supabase = createAdminClient();

  // We deliberately DON'T touch ghl_pipeline_id here — it's managed
  // separately by the GHL Pipeline section. Saving credentials must not
  // wipe out a previously-picked pipeline.
  const { data: existing } = await supabase
    .from("client_credentials")
    .select("ghl_token_secret_id")
    .eq("client_id", clientId)
    .maybeSingle();

  let secretId: string | null = existing?.ghl_token_secret_id ?? null;

  if (token.trim() !== "") {
    secretId = await setVaultSecret(supabase, {
      existingId: secretId,
      secretValue: token.trim(),
      secretName: `ghl_token__${clientSlug}`,
    });
  }

  const { error } = await supabase
    .from("client_credentials")
    .upsert(
      {
        client_id: clientId,
        ghl_token_secret_id: secretId,
        ghl_location_id: locationId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
}

export async function clearGhlCredentials(formData: FormData): Promise<void> {
  assertWritable("Clear Asera credentials");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("client_credentials")
    .select("ghl_token_secret_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (existing?.ghl_token_secret_id) {
    await deleteVaultSecret(supabase, existing.ghl_token_secret_id);
  }

  const { error } = await supabase
    .from("client_credentials")
    .upsert(
      {
        client_id: clientId,
        ghl_token_secret_id: null,
        ghl_location_id: null,
        ghl_pipeline_id: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
}
