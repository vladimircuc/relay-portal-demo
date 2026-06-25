"use server";

/**
 * Server actions for the per-client "Website leads" CRM connection (Web & SEO
 * settings) — for clients that DON'T run ads and so have no ads CRM connection
 * to reuse. Ads clients never see this; they reuse client_credentials.
 *
 *   saveLeadCredentials  — store a GHL token (Vault) + location on
 *                          client_seo_config (lead_ghl_*). Mirrors the ads
 *                          saveGhlCredentials, but writes to the SEO config row
 *                          and is gated by the "web" scope.
 *   saveLeadPipelines    — store which pipeline(s) to scan for website leads
 *                          (empty = scan all; the website rule filters either way).
 *   clearLeadCredentials — remove the token (Vault) + location + pipelines.
 *
 * Leads-only: NO lifecycle-stage mapping (we don't compute revenue here).
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

export async function saveLeadCredentials(formData: FormData): Promise<void> {
  assertWritable("Save lead credentials");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  const token = String(formData.get("token") ?? "");
  const locationId = emptyToNull(String(formData.get("locationId") ?? ""));
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "web");

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("client_seo_config")
    .select("lead_ghl_token_secret_id")
    .eq("client_id", clientId)
    .maybeSingle();

  let secretId: string | null =
    (existing as { lead_ghl_token_secret_id?: string | null } | null)?.lead_ghl_token_secret_id ?? null;

  // Only touch the vault when a new token is actually typed (so the location can
  // be edited without re-entering the token).
  if (token.trim() !== "") {
    secretId = await setVaultSecret(supabase, {
      existingId: secretId,
      secretValue: token.trim(),
      secretName: `ghl_lead_token__${clientSlug}`,
    });
  }

  const { error } = await supabase.from("client_seo_config").upsert(
    {
      client_id: clientId,
      lead_ghl_token_secret_id: secretId,
      lead_ghl_location_id: locationId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/seo`);
}

export async function saveLeadPipelines(formData: FormData): Promise<void> {
  assertWritable("Save lead pipelines");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "web");

  // "" / "__all__" → scan all pipelines (empty array). Otherwise a single id.
  const picked = String(formData.get("pipelineId") ?? "").trim();
  const pipelineIds = picked && picked !== "__all__" ? [picked] : [];

  const supabase = createAdminClient();
  const { error } = await supabase.from("client_seo_config").upsert(
    { client_id: clientId, lead_pipeline_ids: pipelineIds, updated_at: new Date().toISOString() },
    { onConflict: "client_id" },
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/seo`);
}

export async function clearLeadCredentials(formData: FormData): Promise<void> {
  assertWritable("Clear lead credentials");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "web");

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("client_seo_config")
    .select("lead_ghl_token_secret_id")
    .eq("client_id", clientId)
    .maybeSingle();

  const secretId = (existing as { lead_ghl_token_secret_id?: string | null } | null)?.lead_ghl_token_secret_id ?? null;
  if (secretId) await deleteVaultSecret(supabase, secretId);

  const { error } = await supabase.from("client_seo_config").upsert(
    {
      client_id: clientId,
      lead_ghl_token_secret_id: null,
      lead_ghl_location_id: null,
      lead_pipeline_ids: [] as string[],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/seo`);
}
