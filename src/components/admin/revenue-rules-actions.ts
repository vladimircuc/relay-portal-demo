"use server";

/**
 * Server action for the per-client Revenue Rules admin section.
 *
 * Currently the only rule is `revenue_per_show` — a flat amount added
 * to revenue for every appointment held (e.g. $67 for a sports clinic
 * that collects an evaluation fee at every visit). Defaults to 0 for
 * every client, a no-op for clients without a per-visit fee.
 *
 * Empty / non-numeric input → 0. We treat 0 as "no rule" and never
 * persist a NULL.
 *
 * Auth: Ads-scope local super-admin or global super-admin for this
 * client (requireScopeForClient … "ads").
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireScopeForClient } from "@/lib/auth";
import { assertWritable } from "@/lib/demo";

/** Parse "67", "67.5", "67.50", "$67", "67$", "  67 " → 67. Bad input → 0. */
function parseDollar(raw: string): number {
  const cleaned = raw.trim().replace(/[$,]/g, "").trim();
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Clamp to two decimals to avoid floating-point noise on display.
  return Math.round(n * 100) / 100;
}

export async function saveRevenueRules(formData: FormData): Promise<void> {
  assertWritable("Save revenue rules");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const revenue_per_show = parseDollar(String(formData.get("revenue_per_show") ?? ""));

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .update({ revenue_per_show })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  // Bust the admin page (so the input rehydrates) and the dashboard
  // (since this directly affects revenue / ROAS / per-show metrics).
  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/ads`);
}
