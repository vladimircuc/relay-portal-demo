"use server";

/**
 * Server actions for the per-client Funnel Labels admin section.
 *
 * Only the middle two pipeline stages (Booking + Show) are customisable
 * per client — the first (Lead) and last (Conversion) are universal
 * across the platform and hardcoded in the dashboard. Defaults are
 * "Booking" and "Show".
 *
 * Empty input falls back to the canonical default rather than being
 * stored as an empty string — the dashboard never has to render a blank
 * stage label that way.
 *
 * Singular form (not plural) so a custom term like "Quote Sent" doesn't
 * need any auto-pluralisation logic. Wherever the dashboard needs a
 * plural rendering of a custom label (rare; mostly empty-state hints),
 * it uses the singular as-is.
 *
 * Auth: Ads-scope local super-admin or global super-admin for this
 * client (requireScopeForClient … "ads").
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireScopeForClient } from "@/lib/auth";
import { assertWritable } from "@/lib/demo";

/** Trim + clamp to 32 chars + fall back to default if blank. */
function clean(raw: string, fallback: string): string {
  const trimmed = raw.trim().slice(0, 32);
  return trimmed.length === 0 ? fallback : trimmed;
}

export async function saveFunnelLabels(formData: FormData): Promise<void> {
  assertWritable("Save funnel labels");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const funnel_label_booking = clean(String(formData.get("funnel_label_booking") ?? ""), "Booking");
  const funnel_label_show    = clean(String(formData.get("funnel_label_show")    ?? ""), "Show");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({ funnel_label_booking, funnel_label_show })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  // Bust both the admin form (so the inputs rehydrate) and the dashboard
  // (every section displaying these labels needs to re-render).
  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/ads`);
}

/**
 * Reset both labels to their canonical defaults in one shot. Useful
 * when the admin experimented with custom labels and wants to revert.
 */
export async function resetFunnelLabels(formData: FormData): Promise<void> {
  assertWritable("Reset funnel labels");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({
      funnel_label_booking: "Booking",
      funnel_label_show: "Show",
    })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/ads`);
}
