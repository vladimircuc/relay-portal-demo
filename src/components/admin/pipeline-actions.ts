"use server";

/**
 * Server actions for the per-client GHL Pipeline section.
 *
 * Two actions:
 *   setGhlPipeline       — saves which pipeline this client uses, and
 *                          ensures the 4 standard lifecycle phase rows
 *                          exist (booked / no_show / showed / converted)
 *                          so the stage-mapping form has something to
 *                          render.
 *
 *   saveStageMappings    — receives the per-stage phase assignment from
 *                          the stage-mapping form and rewrites
 *                          `client_lifecycle_phases.pipeline_stage_ids`
 *                          for each phase. Also handles the "converted
 *                          requires status=open" toggle for clients
 *                          with Varble-style rules.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireScopeForClient } from "@/lib/auth";
import { assertWritable } from "@/lib/demo";

// ─────────────────────────────────────────────────────────────────────────────
// Standard 4 lifecycle phases. These match what the dashboard's funnel +
// metrics SQL expects. New clients always get these four rows.

const STANDARD_PHASES = [
  { phase_key: "booked",    display_label: "Booked Appointment", sort_order: 1 },
  { phase_key: "no_show",   display_label: "No Show",            sort_order: 2 },
  { phase_key: "showed",    display_label: "Showed Up",          sort_order: 3 },
  { phase_key: "converted", display_label: "Converted",          sort_order: 4 },
] as const;

type PhaseKey = (typeof STANDARD_PHASES)[number]["phase_key"];
const PHASE_KEYS: PhaseKey[] = STANDARD_PHASES.map((p) => p.phase_key);

/**
 * Cumulative membership rule for the standard 4-phase funnel.
 *
 *   Booked → No Show
 *          → Showed → Converted
 *
 * When an opp lands on a particular stage, it has also passed through
 * every earlier phase on its branch. So a stage marked "converted" in
 * the wizard counts toward Converted AND Showed AND Booked. This is what
 * makes the dashboard funnel show realistic numbers (Booked includes
 * everyone who started, not just people sitting in the literal Booked
 * stage right now).
 *
 * Keep this in sync with the funnel UI on the dashboard.
 */
const PHASE_MEMBERSHIP: Record<PhaseKey, readonly PhaseKey[]> = {
  booked:    ["booked"],
  no_show:   ["booked", "no_show"],
  showed:    ["booked", "showed"],
  converted: ["booked", "showed", "converted"],
};

// ─────────────────────────────────────────────────────────────────────────────
// setGhlPipeline — pick which pipeline this client uses

export async function setGhlPipeline(formData: FormData): Promise<void> {
  assertWritable("Set pipeline");

  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  const pipelineId = String(formData.get("pipelineId") ?? "").trim();

  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");
  if (!pipelineId) throw new Error("Pipeline is required");

  const supabase = createAdminClient();

  // Write the pipeline_id onto client_credentials. We upsert because the
  // row may not exist yet (e.g. if the wizard runs before any token save).
  const { error: credErr } = await supabase
    .from("client_credentials")
    .upsert(
      { client_id: clientId, ghl_pipeline_id: pipelineId, updated_at: new Date().toISOString() },
      { onConflict: "client_id" },
    );
  if (credErr) throw new Error(credErr.message);

  // Make sure the 4 standard phase rows exist for this client. We use
  // upsert with on-conflict=do-nothing semantics: existing rows stay
  // untouched (preserving any stage assignments), missing rows get
  // inserted with empty pipeline_stage_ids.
  const phaseRows = STANDARD_PHASES.map((p) => ({
    client_id: clientId,
    phase_key: p.phase_key,
    display_label: p.display_label,
    pipeline_stage_ids: [] as string[],
    sort_order: p.sort_order,
  }));
  const { error: phaseErr } = await supabase
    .from("client_lifecycle_phases")
    .upsert(phaseRows, { onConflict: "client_id,phase_key", ignoreDuplicates: true });
  if (phaseErr) throw new Error(phaseErr.message);

  revalidatePath(`/${clientSlug}/admin`);
}

// ─────────────────────────────────────────────────────────────────────────────
// saveStageMappings — assign each pipeline stage to a lifecycle phase

export async function saveStageMappings(formData: FormData): Promise<void> {
  assertWritable("Save stage mappings");

  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  // Comma-separated list of all stage IDs we know about — so we can iterate
  // even though FormData doesn't preserve which fields existed.
  const allStageIds = String(formData.get("stageIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  // Build the inverted map: { phase_key → [stageIds...] }.
  //
  // Cumulative: a stage marked as e.g. "showed" gets written into BOTH
  // the showed AND booked phase rows, because an opp that showed up
  // necessarily also got booked. PHASE_MEMBERSHIP defines those rollups.
  const inverted: Record<PhaseKey, string[]> = {
    booked: [],
    no_show: [],
    showed: [],
    converted: [],
  };
  for (const stageId of allStageIds) {
    const raw = String(formData.get(`phase_for_${stageId}`) ?? "").trim();
    if (raw === "" || raw === "—" || raw === "none") continue;
    if (!PHASE_KEYS.includes(raw as PhaseKey)) continue;
    const picked = raw as PhaseKey;
    for (const memberPhase of PHASE_MEMBERSHIP[picked]) {
      inverted[memberPhase].push(stageId);
    }
  }

  const supabase = createAdminClient();

  // Upsert each phase with its new stage_ids array. We always send all 4
  // phases so emptied phases (user removed all stages from "no_show", say)
  // also get cleared.
  const rows = STANDARD_PHASES.map((p) => ({
    client_id: clientId,
    phase_key: p.phase_key,
    display_label: p.display_label,
    pipeline_stage_ids: inverted[p.phase_key],
    sort_order: p.sort_order,
  }));

  const { error } = await supabase
    .from("client_lifecycle_phases")
    .upsert(rows, { onConflict: "client_id,phase_key" });
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
}

// ─────────────────────────────────────────────────────────────────────────────
// resetGhlPipeline — un-pick the pipeline (e.g. to choose a different one)
// Clears ghl_pipeline_id and empties all phase mappings. Doesn't delete the
// phase rows themselves so other settings (like sort_order) survive.

export async function resetGhlPipeline(formData: FormData): Promise<void> {
  assertWritable("Reset pipeline");

  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "ads");

  const supabase = createAdminClient();

  await supabase
    .from("client_credentials")
    .upsert(
      { client_id: clientId, ghl_pipeline_id: null, updated_at: new Date().toISOString() },
      { onConflict: "client_id" },
    );

  // Empty out the stage_ids on every phase row.
  await supabase
    .from("client_lifecycle_phases")
    .update({ pipeline_stage_ids: [] as string[] })
    .eq("client_id", clientId);

  revalidatePath(`/${clientSlug}/admin`);
}
