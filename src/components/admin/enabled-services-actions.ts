"use server";

/**
 * Server action for the per-client Services section (admin page).
 *
 * Flips a client's `enabled_services` — which products (Ads / Socials) they
 * get. This is the single source of truth that drives which dashboard tabs
 * render and which /admin capability tabs are manageable, so changing it is a
 * GLOBAL-super-admin-only operation (it adds/removes whole products, and is
 * the entitlement that a local admin's manage-scopes get intersected with).
 *
 * At least one service is always required — a client with zero products would
 * render a dashboard with only the Home tab and nothing to manage.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireGlobalSuperAdmin, type Service } from "@/lib/auth";
import { assertWritable } from "@/lib/demo";

/**
 * Read the chosen products from the form (one `enabled_services` checkbox per
 * service). Filtered to known services + de-duped, in canonical order so the
 * stored array is stable regardless of click order. Enforces the seo ⟹ web
 * invariant server-side (the SEO upsell always rides on the Web base), so even
 * a hand-crafted POST can't persist seo without web.
 */
function parseServicesFromForm(formData: FormData): Service[] {
  const raw = formData.getAll("enabled_services").map(String);
  const set = new Set(raw.filter((s): s is Service => s === "ads" || s === "socials" || s === "web" || s === "seo"));
  if (set.has("seo")) set.add("web");
  return (["ads", "socials", "web", "seo"] as const).filter((c) => set.has(c));
}

export async function updateEnabledServices(formData: FormData): Promise<void> {
  assertWritable("Update services");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");

  await requireGlobalSuperAdmin();

  const services = parseServicesFromForm(formData);
  if (services.length === 0) {
    throw new Error("Pick at least one service (Ads / Socials / Web / SEO).");
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({ enabled_services: services })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  // Entitlements drive the nav + manageable tabs on every one of this client's
  // surfaces, so bust them all — not just /admin. (/home is revalidated too;
  // a path that doesn't exist yet is a harmless no-op.)
  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/ads`);
  revalidatePath(`/${clientSlug}/socials`);
  revalidatePath(`/${clientSlug}/seo`);
  revalidatePath(`/${clientSlug}/home`);
}
