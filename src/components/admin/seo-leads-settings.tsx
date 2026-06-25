/**
 * "Website leads" CRM connection card — shown in Web & SEO settings ONLY for
 * clients that don't run ads (ads clients reuse their existing CRM connection).
 *
 * Two-step flow, mirroring the ads Pipeline section:
 *   1. Connect: paste a GHL token + location → stored on client_seo_config
 *      (token in Vault). Until connected, "Show website leads" shows nothing.
 *   2. Pick pipeline: once connected, discover the location's pipelines and pick
 *      which one holds website leads (or "All pipelines"). The universal website
 *      rule (tag/source) does the actual filtering — no stage mapping, since we
 *      don't compute revenue.
 *
 * Server component (does the live pipeline discovery, like PipelineSection).
 */
import { AlertTriangle, Globe2, Check } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "@/lib/etl/vault";
import { fetchGhlPipelines, type GhlPipeline } from "@/lib/etl/ghl-api";
import { saveLeadCredentials, saveLeadPipelines, clearLeadCredentials } from "./seo-leads-settings-actions";
import { SubmitPrimary, SubmitLink } from "./submit-button";

const FIELD =
  "w-full h-9 px-3 rounded-md bg-[var(--surface-2)] border border-[var(--surface-3)]/70 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--ps-yellow)]/60 outline-none";

type Cfg = {
  lead_ghl_location_id: string | null;
  lead_ghl_token_secret_id: string | null;
  lead_pipeline_ids: string[] | null;
  show_leads: boolean | null;
};

export async function SeoLeadsSettings({ clientId, clientSlug }: { clientId: string; clientSlug: string }) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("client_seo_config")
    .select("lead_ghl_location_id, lead_ghl_token_secret_id, lead_pipeline_ids, show_leads")
    .eq("client_id", clientId)
    .maybeSingle();
  const cfg = (data as Cfg | null) ?? {
    lead_ghl_location_id: null, lead_ghl_token_secret_id: null, lead_pipeline_ids: [], show_leads: false,
  };
  const connected = !!cfg.lead_ghl_token_secret_id && !!cfg.lead_ghl_location_id;

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-5">
      <div className="flex items-center gap-2 flex-wrap">
        <Globe2 size={16} className="text-[var(--accent-fg)]" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Website leads</h2>
        {connected && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border bg-[var(--positive)]/10 border-[var(--positive)]/40 text-[var(--positive)]">
            <Check size={12} strokeWidth={2.5} /> Connected
          </span>
        )}
      </div>
      <p className="text-sm text-[var(--text-secondary)] -mt-3 max-w-2xl">
        This client doesn&apos;t run ads, so connect its CRM (Asera / GHL) here to count website-sourced
        leads on the Web &amp; SEO tab. Turn the count on with &quot;Show website leads&quot; in the SEO section above.
      </p>

      {!connected ? (
        <ConnectForm clientId={clientId} clientSlug={clientSlug} location={cfg.lead_ghl_location_id} />
      ) : (
        <Connected clientId={clientId} clientSlug={clientSlug} cfg={cfg} />
      )}
    </section>
  );
}

function ConnectForm({ clientId, clientSlug, location }: { clientId: string; clientSlug: string; location: string | null }) {
  return (
    <form action={saveLeadCredentials} className="flex flex-col gap-3 max-w-2xl">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="clientSlug" value={clientSlug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">CRM token</span>
          <input type="password" name="token" autoComplete="off" placeholder="pit-… or API token" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Location ID</span>
          <input type="text" name="locationId" defaultValue={location ?? ""} placeholder="e.g. NchMBuPj77FSNeXz3SYz" className={FIELD} />
        </label>
      </div>
      <div>
        <SubmitPrimary pendingLabel="Connecting…" className="px-3 py-1.5 text-[12px] w-fit">Connect CRM</SubmitPrimary>
      </div>
    </form>
  );
}

async function Connected({ clientId, clientSlug, cfg }: { clientId: string; clientSlug: string; cfg: Cfg }) {
  // Discover pipelines from the saved lead connection.
  let pipelines: GhlPipeline[] = [];
  let fetchError: string | null = null;
  try {
    const supabase = createAdminClient();
    const token = await getVaultSecret(supabase, cfg.lead_ghl_token_secret_id!);
    pipelines = await fetchGhlPipelines({ token, locationId: cfg.lead_ghl_location_id! });
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  const current = cfg.lead_pipeline_ids?.[0] ?? "__all__";

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      {fetchError ? (
        <div className="bg-[var(--negative)]/8 border border-[var(--negative)]/30 rounded-md p-4 text-sm flex gap-3 items-start">
          <AlertTriangle size={16} className="text-[var(--negative)] shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-[var(--text-primary)] break-words">{fetchError}</span>
            <span className="text-[var(--text-tertiary)] text-[12px]">Double-check the token and location, then reconnect.</span>
          </div>
        </div>
      ) : (
        <form action={saveLeadPipelines} className="flex flex-col gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="clientSlug" value={clientSlug} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Lead pipeline</span>
            <select name="pipelineId" defaultValue={current}
              className="bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--ps-yellow)]">
              <option value="__all__">All pipelines (filter by website rule)</option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.stages.length} stage{p.stages.length === 1 ? "" : "s"})</option>
              ))}
            </select>
            <span className="text-[11px] text-[var(--text-tertiary)] leading-snug">
              We scan this pipeline (or all) and keep only opportunities tagged as website / chat-widget leads.
            </span>
          </label>
          <div>
            <SubmitPrimary pendingLabel="Saving…" className="px-3 py-1.5 text-[12px] w-fit">Save pipeline</SubmitPrimary>
          </div>
        </form>
      )}

      <form action={clearLeadCredentials} className="border-t border-[var(--surface-3)]/40 pt-3">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="clientSlug" value={clientSlug} />
        <SubmitLink pendingLabel="Disconnecting…" className="!text-[var(--text-tertiary)]">Disconnect CRM</SubmitLink>
      </form>
    </div>
  );
}
