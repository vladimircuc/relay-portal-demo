/**
 * Thin TS wrapper around the SECURITY DEFINER vault helpers
 * (migration 006_vault_admin_helpers.sql).
 *
 * Why we wrap them:
 *   - Single typed surface; callers don't need to remember RPC names.
 *   - Centralized error handling — every call throws on failure so server
 *     actions / ETL routes don't need to repeat the `if (error) throw` dance.
 *   - Keeps "vault writes" out of business-logic files so secret handling
 *     is auditable in one place.
 *
 * All four functions MUST be called from the server only, via the service-role
 * admin client (createAdminClient). They will fail when called from the
 * anon or authenticated roles — that's by design (see GRANTs in migration 006).
 */
import { createAdminClient } from "@/lib/supabase/server";

type Supa = ReturnType<typeof createAdminClient>;

/**
 * Create OR replace a vault secret.
 *
 *   - If `existingId` is null/undefined → creates a new secret with the
 *     given name, returns the new UUID.
 *   - If `existingId` is provided     → updates that secret in place,
 *     returns the same UUID back.
 *
 * Use the returned UUID as the value of `*_secret_id` in `client_credentials`.
 */
export async function setVaultSecret(
  supabase: Supa,
  args: { existingId: string | null; secretValue: string; secretName: string },
): Promise<string> {
  const { existingId, secretValue, secretName } = args;
  const { data, error } = await supabase.rpc("admin_set_secret", {
    existing_id: existingId,
    secret_value: secretValue,
    secret_name: secretName,
  });
  if (error) throw new Error(`Vault setSecret failed: ${error.message}`);
  if (!data) throw new Error("Vault setSecret returned no UUID");
  return data as string;
}

/** Delete a vault secret. No-op if it doesn't exist. */
export async function deleteVaultSecret(supabase: Supa, secretId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_secret", { secret_id: secretId });
  if (error) throw new Error(`Vault deleteSecret failed: ${error.message}`);
}

/**
 * Fetch the plaintext value of a vault secret by id. Used by the ETL routes
 * (Meta / GHL pulls) when they need the actual token to call external APIs.
 *
 * NEVER expose the returned value to the client / browser. Treat it as a
 * write-only-once string inside the ETL function call.
 */
export async function getVaultSecret(supabase: Supa, secretId: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_get_secret", { secret_id: secretId });
  if (error) throw new Error(`Vault getSecret failed: ${error.message}`);
  if (!data) throw new Error(`Vault secret ${secretId} returned empty`);
  return data as string;
}
