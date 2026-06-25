/**
 * High-level GHL pull — paginates every opportunity for one client and
 * upserts them into `ghl_opportunities`.
 *
 * Returns the number of rows written. Caller wraps this in withEtlRun()
 * for `etl_runs` logging and cache invalidation.
 *
 * Idempotent: ghl_opportunities has UNIQUE (client_id, ghl_id), so re-runs
 * just overwrite existing rows. We do NOT delete rows that no longer
 * appear in GHL — opportunities can be archived but their history is
 * still useful for historical reporting. If we ever need that, add a
 * `delete missing` pass later.
 *
 * Heads-up about runtime length:
 *   Each page of 100 opps costs ~1.5s (network + the inter-page pause).
 *   A client with 5,000 opps = 50 pages = ~75 seconds. Stays under
 *   Vercel Pro's 300s function limit but won't fit Hobby's 60s. Run on
 *   Pro or split into chunks if a client grows past ~3,500 opps.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "./vault";
import { fetchGhlOpportunities, type GhlOpportunity } from "./ghl-api";

export async function runGhlPull(args: {
  clientId: string;
}): Promise<{ rowsWritten: number }> {
  const { clientId } = args;
  const supabase = createAdminClient();

  // 1. Look up credentials.
  const { data: creds, error: credErr } = await supabase
    .from("client_credentials")
    .select("ghl_token_secret_id, ghl_location_id, ghl_pipeline_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (credErr) throw new Error(`Loading Asera credentials failed: ${credErr.message}`);
  if (!creds?.ghl_token_secret_id || !creds.ghl_location_id) {
    throw new Error(
      "Asera credentials not configured for this client. Set the token and location ID in /[clientSlug]/admin first.",
    );
  }

  // 2. Decrypt the token.
  const token = await getVaultSecret(supabase, creds.ghl_token_secret_id);

  // 3. Paginate every opportunity.
  const opps = await fetchGhlOpportunities({
    token,
    locationId: creds.ghl_location_id,
    pipelineId: creds.ghl_pipeline_id,
  });

  if (opps.length === 0) {
    return { rowsWritten: 0 };
  }

  // 3a. Wipe any leftover seed-synthetic rows for this client.
  //
  // Seed scripts (seed/seed_varble.py, seed_stl_sports_clinic.py) bootstrap
  // a client's ghl_opportunities table with rows whose ghl_id has the
  // form `seed_<hash>` — that's the synthetic ID we mint because the
  // spreadsheets don't carry the real GHL opp.id. Once the live ETL
  // starts pulling actual opportunities from GHL with their REAL UUIDs,
  // the seed rows can't dedupe via upsert (different ghl_id → no
  // conflict) so they sit alongside the live rows and double every
  // count.
  //
  // Deleting them here, on every live pull, is idempotent (no-op when
  // a client wasn't seeded) and self-healing for STL-style oversights.
  // If we ever want to keep seed rows alongside live data for
  // comparison, we'd need an opt-in flag — but for the actual onboarding
  // flow, "wipe on first live data" is what we want.
  const { error: wipeErr } = await supabase
    .from("ghl_opportunities")
    .delete()
    .eq("client_id", clientId)
    .like("ghl_id", "seed_%");
  if (wipeErr) {
    // Not fatal — log and continue. Worst case the user sees doubled
    // numbers like the STL incident and we clean up manually.
    console.error(
      `[ghl] seed-row wipe failed for client ${clientId}: ${wipeErr.message}`,
    );
  }

  // 4. Reshape and upsert in batches. Supabase has a request-size limit
  //    (default ~1MB); 500 opps per batch keeps us well under it even
  //    with the raw JSON blob attached.
  const rows = opps.map((o) => oppToRow(clientId, o));
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error: upErr } = await supabase
      .from("ghl_opportunities")
      .upsert(slice, { onConflict: "client_id,ghl_id" });
    if (upErr) {
      throw new Error(
        `ghl_opportunities upsert failed at batch starting index ${i}: ${upErr.message}`,
      );
    }
    written += slice.length;
  }

  return { rowsWritten: written };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

/** Coerce GHL's various monetaryValue shapes (null/string/number) → number. */
function toMonetary(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function oppToRow(clientId: string, o: GhlOpportunity) {
  const contact = o.contact ?? {};
  return {
    client_id: clientId,
    ghl_id: o.id,
    // Fallback to "now" if GHL somehow returns an opp without createdAt —
    // the column is NOT NULL. In practice GHL always sends it.
    created_at_ghl: o.createdAt ?? new Date().toISOString(),
    updated_at_ghl: o.updatedAt ?? null,
    opportunity_name: o.name ?? null,
    contact_name: contact.name ?? null,
    contact_phone: contact.phone ?? null,
    contact_email: contact.email ?? null,
    monetary_value: toMonetary(o.monetaryValue),
    source: o.source ?? null,
    assigned_to: o.assignedTo ?? null,
    tags: Array.isArray(contact.tags) ? contact.tags : null,
    status: o.status ?? null,
    pipeline_stage_id: o.pipelineStageId ?? null,
    pipeline_id: o.pipelineId ?? null,
    // Keep the full GHL payload for future fields without schema changes.
    raw: o,
    fetched_at: new Date().toISOString(),
  };
}
