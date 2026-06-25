"use server";

/**
 * Server actions for the per-client Funnel Goals admin section.
 *
 * Goals are stage-to-stage conversion rate targets stored as decimals
 * (0.7 = 70%) on the `clients` row. The form accepts whole-number percents
 * (the user types "70", not "0.7") — we normalize on save.
 *
 * Empty fields = clear the goal (NULL). The funnel dashboard pill turns
 * neutral grey when a goal is unset. Saving an empty Save form is a no-op
 * for unset goals and clears any previously-set goal.
 *
 * Auth: Ads-scope local super-admin or global super-admin for this
 * client (requireScopeForClient … "ads"). RLS would also block these
 * writes for client_users since they go through the admin (service_role)
 * client, but the explicit guard makes the contract clear.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireScopeForClient } from "@/lib/auth";
import { assertWritable } from "@/lib/demo";

/**
 * Parse a percent-string from the form into a decimal (0..1).
 *
 * Accepts:  "70", "70.5", "  70 ", "70%"   →  0.7, 0.705, 0.7, 0.7
 * Rejects (returns null): "", "abc", negative, > 100
 *
 * NULL means "clear / unset" — distinct from 0 (a goal of zero) so callers
 * can preserve the difference if they ever want to allow 0% targets.
 */
function parsePercent(raw: string): number | null {
  const cleaned = raw.trim().replace(/%$/, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 100) return null;
  return n / 100;
}

export async function saveFunnelGoals(formData: FormData): Promise<void> {
  assertWritable("Save funnel goals");

  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const goal_lead_to_booking    = parsePercent(String(formData.get("leadToBooking")    ?? ""));
  const goal_show_rate          = parsePercent(String(formData.get("showRate")         ?? ""));
  const goal_show_to_conversion = parsePercent(String(formData.get("showToConversion") ?? ""));

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({
      goal_lead_to_booking,
      goal_show_rate,
      goal_show_to_conversion,
    })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
  // The dashboard reads goals via the cached client lookup. The page is
  // server-rendered fresh on every navigation though, so just revalidating
  // the admin path is enough; the dashboard will pick up the new values
  // on its next request.
  revalidatePath(`/${clientSlug}/ads`);
}

export async function clearFunnelGoals(formData: FormData): Promise<void> {
  assertWritable("Clear funnel goals");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({
      goal_lead_to_booking: null,
      goal_show_rate: null,
      goal_show_to_conversion: null,
    })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/ads`);
}
