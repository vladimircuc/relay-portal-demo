/**
 * Per-client Asera Pipeline section — discover pipelines via the API,
 * pick one, then assign each stage to a lifecycle phase.
 *
 * Two-step flow:
 *
 *   1. Discovery: server calls GET /opportunities/pipelines using this
 *      client's token (from vault) + location_id. Renders a dropdown of
 *      pipeline names. No UUID copy-paste required.
 *
 *   2. Stage mapping: once a pipeline is picked, render every stage
 *      from that pipeline as a row with a dropdown to assign it to a
 *      lifecycle phase (Booked / No Show / Showed / Converted / —).
 *
 * Special states the UI gracefully handles:
 *   - Asera credentials not saved yet → "Save Asera credentials first."
 *   - Token / location are wrong → "Asera request failed: …" with details.
 *   - Pipeline ID in DB no longer exists in the API response → "Pipeline
 *      not found in Asera anymore — pick a new one."
 */
import { AlertTriangle, ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "@/lib/etl/vault";
import { fetchGhlPipelines, type GhlPipeline } from "@/lib/etl/ghl-api";
import { DEMO } from "@/lib/demo";
import {
  setGhlPipeline,
  saveStageMappings,
  resetGhlPipeline,
} from "./pipeline-actions";
import { SubmitPrimary, SubmitLink } from "./submit-button";

type Props = {
  clientId: string;
  clientSlug: string;
};

type CredsRow = {
  ghl_token_secret_id: string | null;
  ghl_location_id: string | null;
  ghl_pipeline_id: string | null;
};

type PhaseRow = {
  phase_key: string;
  display_label: string;
  pipeline_stage_ids: string[];
  sort_order: number;
};

const PHASE_OPTIONS = [
  { value: "",          label: "— (ignore)" },
  { value: "booked",    label: "Booked" },
  { value: "no_show",   label: "No Show" },
  { value: "showed",    label: "Showed" },
  { value: "converted", label: "Converted" },
];

export async function PipelineSection({ clientId, clientSlug }: Props) {
  const supabase = createAdminClient();

  const [{ data: creds }, { data: phases }] = await Promise.all([
    supabase
      .from("client_credentials")
      .select("ghl_token_secret_id, ghl_location_id, ghl_pipeline_id")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("client_lifecycle_phases")
      .select("phase_key, display_label, pipeline_stage_ids, sort_order")
      .eq("client_id", clientId)
      .order("sort_order", { ascending: true }),
  ]);

  const credsRow = creds as CredsRow | null;
  const phaseRows = (phases as PhaseRow[] | null) ?? [];

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <GitBranch size={16} className="text-[var(--accent-fg)]" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Asera Pipeline</h2>
      </div>
      <p className="text-sm text-[var(--text-secondary)] -mt-3">
        Pick which Asera pipeline this client uses, then map each stage to a lifecycle phase. The
        dashboard&apos;s funnel (Leads → Bookings → Shows → Conversions) is built from these mappings.
      </p>

      <Body
        creds={credsRow}
        phases={phaseRows}
        clientId={clientId}
        clientSlug={clientSlug}
      />
    </section>
  );
}

async function Body({
  creds,
  phases,
  clientId,
  clientSlug,
}: {
  creds: CredsRow | null;
  phases: PhaseRow[];
  clientId: string;
  clientSlug: string;
}) {
  // ── Demo: never call the Asera API. Show the configured stage→phase mapping
  //    built from the seeded lifecycle phases instead of a live discovery. ──
  if (DEMO) {
    return <DemoConfiguredPipeline phases={phases} />;
  }

  // ── No Asera credentials yet ────────────────────────────────────────────
  if (!creds?.ghl_token_secret_id || !creds.ghl_location_id) {
    return (
      <EmptyState
        title="Save Asera credentials first"
        message="Add the Asera token and location ID in the Credentials section above. Once saved, we can discover this location's pipelines automatically — no more copy-pasting UUIDs."
      />
    );
  }

  // ── Try to fetch pipelines from Asera ───────────────────────────────────
  let pipelines: GhlPipeline[] = [];
  let fetchError: string | null = null;
  try {
    const supabase = createAdminClient();
    const token = await getVaultSecret(supabase, creds.ghl_token_secret_id);
    pipelines = await fetchGhlPipelines({ token, locationId: creds.ghl_location_id });
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  if (fetchError) {
    return (
      <ErrorState
        message={fetchError}
        hint="Double-check the Asera token and location ID, then try again."
      />
    );
  }

  if (pipelines.length === 0) {
    return (
      <EmptyState
        title="No pipelines found"
        message="The Asera API returned zero pipelines for this location. Confirm the location ID is correct."
      />
    );
  }

  // ── No pipeline picked yet → render pipeline picker ─────────────────────
  if (!creds.ghl_pipeline_id) {
    return <PipelinePicker pipelines={pipelines} clientId={clientId} clientSlug={clientSlug} />;
  }

  // ── Pipeline ID set but missing from API response (stale config) ────────
  const current = pipelines.find((p) => p.id === creds.ghl_pipeline_id);
  if (!current) {
    return (
      <ErrorState
        message={`Saved pipeline ID ${creds.ghl_pipeline_id.slice(0, 8)}… isn't in the Asera response anymore. It may have been deleted in Asera.`}
        hint={
          <form action={resetGhlPipeline}>
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="clientSlug" value={clientSlug} />
            <SubmitLink pendingLabel="Clearing…" className="!text-[var(--accent-fg)]">
              Clear and pick a different pipeline
            </SubmitLink>
          </form>
        }
      />
    );
  }

  // ── Pipeline picked → render stage-mapping form ─────────────────────────
  return (
    <StageMapping
      pipeline={current}
      phases={phases}
      clientId={clientId}
      clientSlug={clientSlug}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline picker — dropdown of all pipelines for the location

function PipelinePicker({
  pipelines,
  clientId,
  clientSlug,
}: {
  pipelines: GhlPipeline[];
  clientId: string;
  clientSlug: string;
}) {
  return (
    <form action={setGhlPipeline} className="flex flex-col gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="clientSlug" value={clientSlug} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
          Pipeline
        </span>
        <select
          name="pipelineId"
          required
          defaultValue=""
          className="bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--ps-yellow)]"
        >
          <option value="" disabled>
            Select a pipeline…
          </option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.stages.length} stage{p.stages.length === 1 ? "" : "s"})
            </option>
          ))}
        </select>
      </label>

      <div className="flex justify-end">
        <SubmitPrimary pendingLabel="Setting…">
          Use this pipeline
          <ChevronRight size={14} />
        </SubmitPrimary>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage mapping — assign each stage in the picked pipeline to a phase

function StageMapping({
  pipeline,
  phases,
  clientId,
  clientSlug,
}: {
  pipeline: GhlPipeline;
  phases: PhaseRow[];
  clientId: string;
  clientSlug: string;
}) {
  // Invert phases into a map: stageId → phase_key for current defaults.
  const stageToPhase = new Map<string, string>();
  for (const ph of phases) {
    for (const sid of ph.pipeline_stage_ids) stageToPhase.set(sid, ph.phase_key);
  }

  // Counts for the collapsed-summary line.
  const totalStages = pipeline.stages.length;
  const mappedStages = pipeline.stages.filter((s) => stageToPhase.has(s.id)).length;
  const phaseCounts = { booked: 0, no_show: 0, showed: 0, converted: 0 } as Record<string, number>;
  for (const stage of pipeline.stages) {
    const phase = stageToPhase.get(stage.id);
    if (phase && phase in phaseCounts) phaseCounts[phase]++;
  }
  // Open by default when nothing's mapped yet — guides the user to fill it
  // in on first visit. Once at least one stage is mapped, stay collapsed
  // so the page isn't dominated by the table.
  const startOpen = mappedStages === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="text-[var(--text-tertiary)]">Pipeline:</span>{" "}
          <span className="font-semibold text-[var(--text-primary)]">{pipeline.name}</span>
          <span className="text-[var(--text-tertiary)]"> · {pipeline.stages.length} stages</span>
        </div>

        <form action={resetGhlPipeline}>
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="clientSlug" value={clientSlug} />
          <SubmitLink pendingLabel="Resetting…">Pick a different pipeline</SubmitLink>
        </form>
      </div>

      <details
        className="ps-collapse border border-[var(--surface-3)]/40 rounded-md overflow-hidden"
        {...(startOpen ? { open: true } : {})}
      >
        <summary className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--surface-2)]/40 hover:bg-[var(--surface-2)]/70 transition-colors">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <ChevronDown
              size={14}
              className="ps-collapse-chevron text-[var(--text-tertiary)] shrink-0"
            />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {mappedStages === 0 ? (
                <>Map stages to lifecycle phases</>
              ) : (
                <>
                  {mappedStages} of {totalStages} stages mapped
                </>
              )}
            </span>
            {mappedStages > 0 && (
              <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
                {phaseCounts.booked > 0 && (
                  <PhaseChip label="Booked" count={phaseCounts.booked} />
                )}
                {phaseCounts.no_show > 0 && (
                  <PhaseChip label="No Show" count={phaseCounts.no_show} />
                )}
                {phaseCounts.showed > 0 && (
                  <PhaseChip label="Showed" count={phaseCounts.showed} />
                )}
                {phaseCounts.converted > 0 && (
                  <PhaseChip label="Converted" count={phaseCounts.converted} />
                )}
              </div>
            )}
          </div>
          <span className="text-[11px] text-[var(--text-tertiary)] shrink-0">
            Click to edit
          </span>
        </summary>

        <form
          action={saveStageMappings}
          className="flex flex-col gap-4 p-4 border-t border-[var(--surface-3)]/40"
        >
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="clientSlug" value={clientSlug} />
          <input
            type="hidden"
            name="stageIds"
            value={pipeline.stages.map((s) => s.id).join(",")}
          />

          <div className="border border-[var(--surface-3)]/40 rounded-md overflow-hidden">
            <div className="grid grid-cols-[1fr_220px] bg-[var(--surface-2)]/60 px-4 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium border-b border-[var(--surface-3)]/40">
              <div>Stage</div>
              <div>Lifecycle phase</div>
            </div>
            {pipeline.stages.map((stage, i) => {
              const currentPhase = stageToPhase.get(stage.id) ?? "";
              return (
                <div
                  key={stage.id}
                  className={
                    "grid grid-cols-[1fr_220px] items-center px-4 py-2.5 gap-3 " +
                    (i < pipeline.stages.length - 1 ? "border-b border-[var(--surface-3)]/30" : "")
                  }
                >
                  <div className="text-sm text-[var(--text-primary)] truncate">{stage.name}</div>
                  {/* Selected phase is controlled at the <select> via
                      defaultValue (uncontrolled — the form posts by `name`).
                      We previously set `selected` on the matching <option> to
                      dodge a prod symptom where every dropdown showed
                      "(ignore)"; that was almost certainly a stale-cached-HTML
                      artifact, not a real defaultValue bug — so this is back to
                      the React-idiomatic form (and silences React's warning). */}
                  <select
                    name={`phase_for_${stage.id}`}
                    defaultValue={currentPhase}
                    className="bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--ps-yellow)] tabular-nums"
                  >
                    {PHASE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <SubmitPrimary pendingLabel="Saving…">Save mapping</SubmitPrimary>
          </div>
        </form>
      </details>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo: read-only "configured" view. The live product discovers stages from the
// Asera API and maps them here; in the demo we render the seeded stage→phase
// mapping so the section reads as fully set up without any external call.

function DemoConfiguredPipeline({ phases }: { phases: PhaseRow[] }) {
  const ordered = [...phases].sort((a, b) => a.sort_order - b.sort_order);
  const stageCount = (p: PhaseRow) => p.pipeline_stage_ids?.length ?? 0;
  const totalStages = ordered.reduce((n, p) => n + stageCount(p), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="text-[var(--text-tertiary)]">Pipeline:</span>{" "}
          <span className="font-semibold text-[var(--text-primary)]">Client Sales Pipeline</span>
          <span className="text-[var(--text-tertiary)]"> · {totalStages} stages, all mapped</span>
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-md border text-[var(--positive)] border-[var(--positive)]/30 bg-[var(--positive)]/10">
          Configured
        </span>
      </div>

      <div className="border border-[var(--surface-3)]/40 rounded-md overflow-hidden">
        <div className="grid grid-cols-[1fr_160px] bg-[var(--surface-2)]/60 px-4 py-2.5 text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium border-b border-[var(--surface-3)]/40">
          <div>Lifecycle phase</div>
          <div>Mapped stages</div>
        </div>
        {ordered.map((ph, i) => (
          <div
            key={ph.phase_key}
            className={
              "grid grid-cols-[1fr_160px] items-center px-4 py-2.5 gap-3 " +
              (i < ordered.length - 1 ? "border-b border-[var(--surface-3)]/30" : "")
            }
          >
            <div className="text-sm text-[var(--text-primary)]">{ph.display_label}</div>
            <div className="text-sm text-[var(--text-secondary)] tabular-nums">
              {stageCount(ph)} stage{stageCount(ph) === 1 ? "" : "s"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PhaseChip({ label, count }: { label: string; count: number }) {
  return (
    <span className="px-1.5 py-0.5 rounded bg-[var(--surface-3)]/50 text-[var(--text-secondary)]">
      {label} <span className="text-[var(--text-primary)] font-semibold">{count}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty + error states

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-5 text-sm flex flex-col gap-1">
      <span className="font-semibold text-[var(--text-primary)]">{title}</span>
      <span className="text-[var(--text-secondary)]">{message}</span>
    </div>
  );
}

function ErrorState({
  message,
  hint,
}: {
  message: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--negative)]/8 border border-[var(--negative)]/30 rounded-md p-5 text-sm flex gap-3 items-start">
      <AlertTriangle size={16} className="text-[var(--negative)] shrink-0 mt-0.5" />
      <div className="flex flex-col gap-2 min-w-0">
        <span className="text-[var(--text-primary)] break-words">{message}</span>
        {hint && <span className="text-[var(--text-tertiary)]">{hint}</span>}
      </div>
    </div>
  );
}
