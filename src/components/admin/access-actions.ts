"use server";

/**
 * Server actions for the per-client Access section.
 *
 * Five actions: add/remove × domain/email, plus updateAllowedEmailScopes
 * to re-scope an existing local super-admin in place. ROLE on email rows
 * is still set at add time (the form has a Viewer / Local super-admin
 * dropdown); changing the role after the fact means removing the row and
 * re-adding. Only the capability SCOPES of an existing local super-admin
 * are editable inline.
 *
 * Auth model — TWO tiers, because granting a local_super_admin is a
 * privilege-escalation surface and must stay global-super-admin-only:
 *   - Viewer grants + ALL domain rows: gated by
 *     `requireAdminForClient(clientId)`. Any local super-admin can add
 *     viewers / domains to their own client (read-only grants).
 *   - local_super_admin grants (add, remove, OR re-scope) + their
 *     capability scopes: gated by `requireGlobalSuperAdmin()`. Only the
 *     big-three global super-admins can mint, revoke, or re-scope another
 *     local super-admin.
 *   - Remove actions take only the row id; we look the row's client_id
 *     (and, for emails, its role) up from the DB first and gate against
 *     THAT — so a hand-crafted POST can't swap in another client's row
 *     id, nor downgrade the gate by lying about the target's role.
 *
 * Validation rules:
 *   - Domain: simple shape like "example.com" or "sub.example.co.uk".
 *     We lowercase, strip "@" if accidentally pasted, and reject empties.
 *   - Email: must contain "@" and a "." in the host part.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import {
  requireAdminForClient,
  requireGlobalSuperAdmin,
  type Capability,
} from "@/lib/auth";
import { isPublicEmailProvider } from "@/lib/email-domains";
import { assertWritable } from "@/lib/demo";

/**
 * Read the selected capability scopes from the add-email form. The form
 * sends one `scopes` checkbox per capability (value "ads" / "socials").
 * Filtered to known capabilities + de-duped. Only meaningful when the
 * row's role is local_super_admin.
 */
function parseScopesFromForm(formData: FormData): Capability[] {
  const raw = formData.getAll("scopes").map(String);
  // Forward-map any legacy "seo" submission to the unified "web" (Web & SEO)
  // capability, then keep only known capabilities, de-duped.
  const valid = raw
    .map((s) => (s === "seo" ? "web" : s))
    .filter((s): s is Capability => s === "ads" || s === "socials" || s === "web");
  return Array.from(new Set(valid));
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers

function cleanDomain(raw: string): string {
  // Strip an accidentally-pasted "user@" prefix and lowercase.
  const stripped = raw.includes("@") ? raw.split("@").pop()! : raw;
  return stripped.trim().toLowerCase();
}

function isDomainLike(d: string): boolean {
  // At least one dot, no whitespace, only domain-y characters.
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d);
}

function cleanEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isEmailLike(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain actions

export async function addDomain(formData: FormData): Promise<void> {
  assertWritable("Add domain");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  const domain = cleanDomain(String(formData.get("domain") ?? ""));

  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireAdminForClient(clientId);
  if (!domain) throw new Error("Domain is required");
  if (!isDomainLike(domain)) throw new Error(`"${domain}" doesn't look like a valid domain`);
  if (isPublicEmailProvider(domain)) {
    throw new Error(
      `"${domain}" is a public email provider — a domain rule would grant access ` +
        `to anyone with that provider. Add the individual address under Allowed emails instead.`,
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("client_domains")
    .insert({ client_id: clientId, email_domain: domain });
  // Unique violation = already exists; swallow it silently so the form
  // feels idempotent. Anything else, surface to the user.
  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }

  revalidatePath(`/${clientSlug}/admin`);
}

export async function removeDomain(formData: FormData): Promise<void> {
  assertWritable("Remove domain");
  const id = String(formData.get("id") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!id || !clientSlug) throw new Error("Missing identifiers");

  const supabase = createAdminClient();
  // Look up the row's owner client first so we can verify the caller
  // can admin THAT client (not just any client). Prevents a malicious
  // POST that swaps in another client's row id.
  const { data: row } = await supabase
    .from("client_domains")
    .select("client_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Row not found");
  await requireAdminForClient(row.client_id);

  const { error } = await supabase.from("client_domains").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Email actions

export async function addAllowedEmail(formData: FormData): Promise<void> {
  assertWritable("Add allowed email");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  const email = cleanEmail(String(formData.get("email") ?? ""));
  const noteRaw = String(formData.get("note") ?? "").trim();
  const note = noteRaw === "" ? null : noteRaw;
  // Role defaults to 'viewer' if the form omits it (or sends something
  // unknown — defensive). The Access UI only surfaces the role choice to
  // global super-admins; we re-check the privilege server-side below.
  const rawRole = String(formData.get("role") ?? "viewer");
  const role: "viewer" | "local_super_admin" =
    rawRole === "local_super_admin" ? "local_super_admin" : "viewer";

  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");

  // Privilege gate keyed on the role being GRANTED:
  //   - local_super_admin → global-super-admin-only (escalation surface),
  //     and the grant must name at least one capability scope.
  //   - viewer            → any local super-admin of this client.
  let scopes: Capability[] | null = null;
  if (role === "local_super_admin") {
    await requireGlobalSuperAdmin();
    scopes = parseScopesFromForm(formData);
    if (scopes.length === 0) {
      throw new Error("Pick at least one capability (Ads / Socials) for a local super-admin.");
    }
  } else {
    await requireAdminForClient(clientId);
  }

  if (!email) throw new Error("Email is required");
  if (!isEmailLike(email)) throw new Error(`"${email}" doesn't look like a valid email`);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("client_allowed_emails")
    .insert({ client_id: clientId, email, note, role, scopes });
  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }

  revalidatePath(`/${clientSlug}/admin`);
}

export async function removeAllowedEmail(formData: FormData): Promise<void> {
  assertWritable("Remove allowed email");
  const id = String(formData.get("id") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!id || !clientSlug) throw new Error("Missing identifiers");

  const supabase = createAdminClient();
  // Pull the target's client_id AND role from the DB — never trust the
  // client to tell us what we're deleting. Removing a local_super_admin
  // is the same escalation surface as adding one, so it's gated to global
  // super-admins; removing a viewer just needs local-admin rights.
  const { data: row } = await supabase
    .from("client_allowed_emails")
    .select("client_id, role")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Row not found");
  if ((row as { role: string }).role === "local_super_admin") {
    await requireGlobalSuperAdmin();
  } else {
    await requireAdminForClient((row as { client_id: string }).client_id);
  }

  const { error } = await supabase.from("client_allowed_emails").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
}

/**
 * Re-scope an existing local_super_admin in place — flip which capability
 * tabs (Ads / Socials) they can manage WITHOUT removing + re-adding the
 * row. Editing scopes is the same escalation surface as minting an LSA,
 * so it's GLOBAL-super-admin-only.
 *
 * We re-look-up the row's role from the DB and refuse if it isn't a
 * local_super_admin — scopes are meaningless on a viewer, and we never
 * trust the client to tell us what kind of row it's editing. At least one
 * capability is required (re-validated here as well as in the UI).
 */
export async function updateAllowedEmailScopes(formData: FormData): Promise<void> {
  assertWritable("Update access scopes");
  const id = String(formData.get("id") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!id || !clientSlug) throw new Error("Missing identifiers");

  await requireGlobalSuperAdmin();

  const scopes = parseScopesFromForm(formData);
  if (scopes.length === 0) {
    throw new Error("Pick at least one capability (Ads / Socials).");
  }

  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("client_allowed_emails")
    .select("role")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Row not found");
  if ((row as { role: string }).role !== "local_super_admin") {
    throw new Error("Scopes only apply to local super-admins.");
  }

  const { error } = await supabase
    .from("client_allowed_emails")
    .update({ scopes })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
}
