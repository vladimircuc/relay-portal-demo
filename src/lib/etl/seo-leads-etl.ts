/**
 * Website-leads pull for the Web & SEO "Show leads" feature.
 *
 * Pulls the configured GHL pipeline(s) for a client, keeps only the
 * website-sourced opportunities (the universal isWebsiteLead rule), and
 * full-replaces them into the ISOLATED `seo_lead_opportunities` table. The Ads
 * dashboard never reads that table, so scanning a non-ads pipeline (e.g.
 * Varble's "New Patient Pipeline") can't pollute its counts.
 *
 * Credentials:
 *   - SEO-only clients store their own GHL token+location on client_seo_config
 *     (lead_ghl_token_secret_id / lead_ghl_location_id).
 *   - Clients that run ads fall back to their client_credentials connection.
 *
 * Pipelines to scan, in priority order:
 *   1. HARDCODED_LEAD_PIPELINES[location] — for clients whose website leads live
 *      outside their ads pipeline (currently just Varble).
 *   2. client_seo_config.lead_pipeline_ids — explicit per-client config.
 *   3. all pipelines (no pipeline filter) — the website RULE filters regardless.
 *
 * Called from runSeoDailyPull (so the nightly cron + the manual "Run backfill"
 * button both refresh leads with no extra wiring). Leads-only — NO revenue, so
 * no lifecycle-stage config is needed.
 */
import type { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "./vault";
import { fetchGhlOpportunities } from "./ghl-api";
import { isWebsiteLead } from "@/lib/meta-source";

type Supa = ReturnType<typeof createAdminClient>;

/**
 * GHL location id → pipeline ids whose opps hold this client's website leads.
 * Hardcoded for clients whose site leads sit OUTSIDE their ads pipeline (so the
 * default "scan all" would still work via the rule, but this is explicit +
 * cheaper — we skip pulling their big ad pipeline).
 *
 *   Varble Orthodontics (location NchMBuPj77FSNeXz3SYz): ads run through "Meta
 *   Ad Pipeline"; website/contact-form leads land in "New Patient Pipeline"
 *   (qzIFOCDff4qXWcqy0oQV). The ads ETL only pulls the Meta pipeline, so without
 *   this the site leads are invisible.
 */
const HARDCODED_LEAD_PIPELINES: Record<string, string[]> = {
  NchMBuPj77FSNeXz3SYz: ["qzIFOCDff4qXWcqy0oQV"],
};

export type LeadSourceCfg = {
  show_leads?: boolean | null;
  lead_ghl_location_id?: string | null;
  lead_ghl_token_secret_id?: string | null;
  lead_pipeline_ids?: string[] | null;
};

export async function runLeadsPull(args: {
  clientId: string;
  supabase: Supa;
  cfg: LeadSourceCfg;
}): Promise<number> {
  const { clientId, supabase, cfg } = args;
  if (!cfg.show_leads) return 0;

  // 1. Resolve credentials — SEO-only override first, else the ads connection.
  let locationId = cfg.lead_ghl_location_id ?? null;
  let tokenSecretId = cfg.lead_ghl_token_secret_id ?? null;
  if (!locationId || !tokenSecretId) {
    const { data: creds } = await supabase
      .from("client_credentials")
      .select("ghl_token_secret_id, ghl_location_id")
      .eq("client_id", clientId)
      .maybeSingle();
    locationId = locationId ?? (creds?.ghl_location_id ?? null);
    tokenSecretId = tokenSecretId ?? (creds?.ghl_token_secret_id ?? null);
  }
  if (!locationId || !tokenSecretId) {
    throw new Error(
      "Website leads are on but no CRM connection (token + location) is configured for this client.",
    );
  }
  const token = await getVaultSecret(supabase, tokenSecretId);

  // 2. Resolve which pipeline(s) to scan: hardcode → config → all.
  let pipelineIds: (string | null)[] = HARDCODED_LEAD_PIPELINES[locationId]
    ?? (cfg.lead_pipeline_ids && cfg.lead_pipeline_ids.length ? cfg.lead_pipeline_ids : []);
  if (!pipelineIds.length) pipelineIds = [null]; // null → all pipelines

  // 3. Pull + filter to website leads. Dedupe by ghl_id (an opp could appear in
  //    multiple pipeline scans only if config overlaps — guard anyway).
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const rows: {
    client_id: string; ghl_id: string; created_at_ghl: string;
    source: string | null; tags: string[] | null; pipeline_id: string | null; fetched_at: string;
  }[] = [];
  for (const pid of pipelineIds) {
    const opps = await fetchGhlOpportunities({ token, locationId, pipelineId: pid ?? undefined });
    for (const o of opps) {
      if (!o.id || seen.has(o.id)) continue;
      const tags = Array.isArray(o.contact?.tags) ? (o.contact!.tags as string[]) : null;
      if (!isWebsiteLead(o.source ?? null, tags)) continue;
      seen.add(o.id);
      rows.push({
        client_id: clientId,
        ghl_id: o.id,
        created_at_ghl: o.createdAt ?? now,
        source: o.source ?? null,
        tags,
        pipeline_id: o.pipelineId ?? null,
        fetched_at: now,
      });
    }
  }

  // 4. Full-replace this client's rows (the pull is exhaustive, so replacing
  //    self-heals opps that were re-classified or removed). Delete happens only
  //    after a SUCCESSFUL pull, so a transient API failure leaves data intact.
  const { error: delErr } = await supabase
    .from("seo_lead_opportunities")
    .delete()
    .eq("client_id", clientId);
  if (delErr) throw new Error(`seo_lead_opportunities clear failed: ${delErr.message}`);

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("seo_lead_opportunities")
      .upsert(slice, { onConflict: "client_id,ghl_id" });
    if (error) throw new Error(`seo_lead_opportunities insert failed: ${error.message}`);
    written += slice.length;
  }
  return written;
}
