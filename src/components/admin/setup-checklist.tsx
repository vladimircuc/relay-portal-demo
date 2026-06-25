/**
 * Onboarding setup checklist — Top-of-page banner on /[slug]/admin.
 *
 * Walks a fresh-from-creation client through the four steps that get a
 * dashboard from "row exists" to "showing real data":
 *
 *   1. Credentials — Meta + Asera access tokens stored in Vault
 *   2. Pipeline — Asera pipeline selected + stages mapped to phases
 *   3. Access — at least one domain or email allowlisted
 *   4. First ETL run — at least one successful pull on record
 *
 * Each step renders as a row with a green check (done) or a "Go to step →"
 * jumplink to the relevant section card lower on the page. When all four
 * are green the entire banner disappears — the checklist is meant to
 * vanish once a client is fully onboarded so it doesn't clutter day-to-day
 * admin sessions.
 *
 * All four lookups are tiny single-row count/select queries fired in
 * parallel, so the banner adds <50ms to the admin page load.
 */
import { Check, CircleDashed } from "lucide-react";
import { getOnboardingStatus, isFullyOnboarded } from "@/lib/onboarding-status";

type Props = {
  clientId: string;
};

type Step = {
  /** Anchor id of the target section card on this page. */
  id: "credentials" | "pipeline" | "access" | "etl";
  label: string;
  done: boolean;
  /** One-line hint when the step is still pending. */
  hint: string;
};

export async function SetupChecklist({ clientId }: Props) {
  const status = await getOnboardingStatus(clientId);

  // Hide the banner entirely once everything's green — the checklist's
  // job is done and we don't need to take up space on routine admin visits.
  if (isFullyOnboarded(status)) return null;

  const steps: Step[] = [
    {
      id: "credentials",
      label: "Connect Meta + Asera",
      done: status.credentials,
      hint: "Paste the Meta access token + ad account ID, then the Asera token + location ID.",
    },
    {
      id: "pipeline",
      label: "Pick the Asera pipeline + map stages",
      done: status.pipeline,
      hint: !status.credentials
        ? "Add the Asera credentials first — pipelines are discovered through that token."
        : "Pick a pipeline and map each stage to a lifecycle phase (booked / showed / converted).",
    },
    {
      id: "access",
      label: "Grant dashboard access",
      done: status.access,
      hint: "Add at least one email domain or individual email so the client can sign in.",
    },
    {
      id: "etl",
      label: "Run the first ETL pull",
      done: status.firstEtlRun,
      hint: !status.credentials || !status.pipeline
        ? "Finish credentials + pipeline first — the ETL needs both to do anything."
        : "Hit “Run now” on Meta and Asera to pull the initial backfill.",
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--ps-yellow)]/30 rounded-[var(--radius-card)] p-6 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Setup checklist
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Finish these to get the dashboard live for this client.
          </p>
        </div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] tabular-nums">
          {completed} of {steps.length} done
        </div>
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className="flex items-start gap-3 px-3 py-2.5 rounded-md bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40"
          >
            {step.done ? (
              <span
                className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-[var(--positive)]/15 border border-[var(--positive)]/40 inline-flex items-center justify-center text-[var(--positive)]"
                aria-label="Done"
              >
                <Check size={12} strokeWidth={3} />
              </span>
            ) : (
              <span
                className="mt-0.5 h-5 w-5 shrink-0 rounded-full inline-flex items-center justify-center text-[var(--text-tertiary)]"
                aria-label="Pending"
              >
                <CircleDashed size={16} />
              </span>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={
                    "text-sm font-medium " +
                    (step.done
                      ? "text-[var(--text-secondary)]"
                      : "text-[var(--text-primary)]")
                  }
                >
                  {i + 1}. {step.label}
                </span>
                {!step.done && (
                  <a
                    href={`#${step.id}`}
                    className="text-[11px] text-[var(--accent-fg)] hover:underline"
                  >
                    Jump to step →
                  </a>
                )}
              </div>
              {!step.done && (
                <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                  {step.hint}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
