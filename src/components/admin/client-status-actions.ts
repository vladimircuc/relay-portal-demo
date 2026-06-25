"use server";

/**
 * Server actions for the per-client lifecycle (Pause / Delete / Restore /
 * Permanently delete).
 *
 *   active  ─ pause ─→ paused
 *   active  ─ delete ─→ deleted
 *   paused  ─ resume ─→ active
 *   paused  ─ delete ─→ deleted
 *   deleted ─ resume ─→ active
 *   deleted ─ permanently delete ─→ (gone, irreversibly)
 *
 * Soft transitions (pause/delete/restore) flip a status column and let
 * the rest of the app react: cron skips non-active clients, the
 * client_user gate in auth.ts treats paused/deleted as no_access, the
 * /clients page groups by status. They're cheap and reversible, so no
 * type-the-slug gate.
 *
 * Permanent delete is irreversible — it cascades through every child
 * table via FK on-delete-cascade, plus we manually nuke the Vault
 * secrets (those live outside the FK graph) and best-effort delete the
 * uploaded Storage logo. The form gates this behind a typed-slug match,
 * AND we re-validate the same match server-side so a hand-crafted POST
 * can't bypass the safety.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireGlobalSuperAdmin } from "@/lib/auth";
import { deleteVaultSecret } from "@/lib/etl/vault";
import { assertWritable } from "@/lib/demo";

function readClientIdentifiers(formData: FormData): { clientId: string; clientSlug: string } {
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  return { clientId, clientSlug };
}

/**
 * Flip `clients.status` between active / paused / deleted.
 *
 * The non-destructive transitions (pause, delete, restore) all funnel
 * through this so behaviour stays uniform. Invalidates both /clients
 * (so the row jumps sections) and the per-client surfaces (so any open
 * tab sees the new state on next render).
 */
async function setClientStatus(
  clientId: string,
  clientSlug: string,
  status: "active" | "paused" | "deleted",
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({ status })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/clients");
  revalidatePath(`/${clientSlug}/ads`);
  revalidatePath(`/${clientSlug}/admin`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft transitions: pause / delete / restore. No confirmation needed —
// all three are reversible with a single click from the same panel.
//
// GLOBAL super-admin only. A client's lifecycle is an agency-level
// decision, so even a local super-admin (scoped to one client) can't
// pause/delete/restore — the UI shows them the buttons disabled and
// this guard is the server-side backstop. Matches permanentlyDeleteClient,
// which has always been global-only.

export async function pauseClient(formData: FormData): Promise<void> {
  assertWritable("Pause client");
  await requireGlobalSuperAdmin();
  const { clientId, clientSlug } = readClientIdentifiers(formData);
  await setClientStatus(clientId, clientSlug, "paused");
  redirect(`/${clientSlug}/admin`);
}

export async function softDeleteClient(formData: FormData): Promise<void> {
  assertWritable("Delete client");
  await requireGlobalSuperAdmin();
  const { clientId, clientSlug } = readClientIdentifiers(formData);
  await setClientStatus(clientId, clientSlug, "deleted");
  redirect(`/${clientSlug}/admin`);
}

export async function restoreClient(formData: FormData): Promise<void> {
  assertWritable("Restore client");
  await requireGlobalSuperAdmin();
  const { clientId, clientSlug } = readClientIdentifiers(formData);
  await setClientStatus(clientId, clientSlug, "active");
  redirect(`/${clientSlug}/admin`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Permanent delete — only allowed from `status='deleted'`. Type-the-slug
// gate AND server-side re-check. Cleans up the rows that on-delete-cascade
// doesn't reach (Vault secrets, Storage objects) before nuking the row.

export async function permanentlyDeleteClient(formData: FormData): Promise<void> {
  assertWritable("Permanently delete client");
  // Hard-delete stays GLOBAL super-admin only on purpose: a local
  // super-admin on a client shouldn't be able to irreversibly nuke that
  // client's data. Only Relay staff can pull this trigger.
  await requireGlobalSuperAdmin();
  const { clientId, clientSlug } = readClientIdentifiers(formData);
  const slugConfirm = String(formData.get("slugConfirm") ?? "").trim();

  // Defence in depth — the client-side form keeps the submit button
  // disabled until typed matches, but never trust the browser.
  if (slugConfirm !== clientSlug) {
    throw new Error(
      `Confirmation didn't match — type "${clientSlug}" exactly to permanently delete.`,
    );
  }

  const supabase = createAdminClient();

  // Only permit hard-delete from the 'deleted' state. This gives the
  // super-admin two clear pauses before destruction: first they have to
  // soft-delete the client, then they have to type its slug. There's no
  // one-click path from active to gone.
  const { data: row } = await supabase
    .from("clients")
    .select("id, slug, name, status")
    .eq("id", clientId)
    .maybeSingle();
  if (!row) {
    // Already gone — treat as a successful no-op rather than an error
    // so a double-submit doesn't blow up.
    redirect("/clients");
  }
  if (row!.status !== "deleted") {
    throw new Error(
      "Permanent delete is only allowed from the Deleted state. Soft-delete the client first.",
    );
  }

  // 1) Vault secrets — these live outside the FK graph, so the
  //    on-delete-cascade from clients won't reach them. Read the secret
  //    IDs before deleting the credentials row, then delete the
  //    secrets. Failures here are non-fatal (the row will be gone
  //    either way, the secrets just become orphaned).
  const { data: creds } = await supabase
    .from("client_credentials")
    .select("meta_access_token_secret_id, ghl_token_secret_id")
    .eq("client_id", clientId)
    .maybeSingle();
  for (const secretId of [
    creds?.meta_access_token_secret_id,
    creds?.ghl_token_secret_id,
  ]) {
    if (!secretId) continue;
    try {
      await deleteVaultSecret(supabase, secretId);
    } catch {
      // Best-effort — don't block deletion on a stuck vault entry.
    }
  }

  // 1b) Social-platform Vault secrets. The Socials-module OAuth tokens
  //     (Meta page token, YouTube, TikTok, LinkedIn) live in a SEPARATE
  //     table — client_social_credentials — which cascade-deletes with the
  //     client. So we must read its secret ids and drop them HERE, before
  //     the row vanishes, or they'd be orphaned in Vault forever (the
  //     disconnect flow does exactly this). One client can have several
  //     rows (one per connected platform). Same best-effort swallow.
  const { data: socialCreds } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id")
    .eq("client_id", clientId);
  for (const sc of socialCreds ?? []) {
    const secretId = (sc as { access_token_secret_id: string | null }).access_token_secret_id;
    if (!secretId) continue;
    try {
      await deleteVaultSecret(supabase, secretId);
    } catch {
      // Best-effort — don't block deletion on a stuck vault entry.
    }
  }

  // 2) Logo in Supabase Storage — best-effort. We delete every file
  //    whose name starts with the slug (covers re-uploads which use
  //    different timestamps in the filename). If listing fails we move
  //    on rather than block the client deletion.
  try {
    const { data: files } = await supabase.storage
      .from("client-logos")
      .list("", { limit: 100 });
    const toDelete = (files ?? [])
      .filter((f) => f.name.startsWith(`${clientSlug}-`) || f.name.startsWith(`${clientSlug}.`))
      .map((f) => f.name);
    if (toDelete.length > 0) {
      await supabase.storage.from("client-logos").remove(toDelete);
    }
  } catch {
    // Storage cleanup is non-fatal — orphaned logos are cheap.
  }

  // 3) The actual row — on-delete-cascade handles client_credentials,
  //    client_social_credentials, client_domains, client_allowed_emails,
  //    client_lifecycle_phases, client_metric_settings, meta_daily,
  //    ghl_opportunities, etl_runs, and the social history tables
  //    (social_daily_metrics, social_posts, client_tiktok_videos,
  //    social_backfill_jobs). The Vault secrets behind client_credentials
  //    and client_social_credentials are cleaned up in steps 1 and 1b above
  //    because Vault lives outside the FK graph.
  const { error: deleteError } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId);
  if (deleteError) throw new Error(deleteError.message);

  revalidatePath("/clients");
  redirect("/clients");
}
