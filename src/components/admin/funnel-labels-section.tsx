/**
 * Per-client Funnel Labels admin section.
 *
 * Two free-text inputs — one for each of the MIDDLE TWO pipeline
 * stages (Booking + Show). The first + last stages (Lead + Conversion)
 * are universal across all clients on the platform and hardcoded in
 * the dashboard, so we can render them with proper singular/plural
 * grammar ("Lead" vs "Leads", "Conversion" vs "Conversions").
 *
 * Whatever lands here is what the dashboard surfaces every time it
 * names stage 2 or 3:
 *   - Pipeline Funnel (side info + mobile in-trapezoid text)
 *   - Cost Efficiency (Cost per X)
 *   - Revenue Efficiency (Avg Rev per X)
 *   - Projected card
 *   - Projection banner (X rate) + explainer modal
 *   - Funnel Goals (Lead → X / X rate / X → Conversion)
 *
 * Defaults: "Booking" / "Show". Singular form is enforced by convention
 * (the description tells the admin) — we don't pluralise anywhere, so
 * a custom term like "Quote Sent" never has to deal with awkward
 * grammar like "Quote Sents".
 */
import { createAdminClient } from "@/lib/supabase/server";
import { saveFunnelLabels, resetFunnelLabels } from "./funnel-labels-actions";
import { SubmitPrimary, SubmitLink } from "./submit-button";

type Props = {
  clientId: string;
  clientSlug: string;
};

type LabelsRow = {
  funnel_label_booking: string;
  funnel_label_show: string;
};

const DEFAULTS: LabelsRow = {
  funnel_label_booking: "Booking",
  funnel_label_show: "Show",
};

export async function FunnelLabelsSection({ clientId, clientSlug }: Props) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("clients")
    .select("funnel_label_booking, funnel_label_show")
    .eq("id", clientId)
    .maybeSingle();

  const labels: LabelsRow = (data as LabelsRow | null) ?? DEFAULTS;

  // Enable Reset only when at least one label differs from the canonical
  // default. Mirrors the "Clear all"-when-anySet pattern in funnel-goals.
  const anyCustom =
    labels.funnel_label_booking !== DEFAULTS.funnel_label_booking ||
    labels.funnel_label_show !== DEFAULTS.funnel_label_show;

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Funnel Labels</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          The first + last pipeline stages are always{" "}
          <strong className="text-[var(--text-primary)]">Lead</strong> and{" "}
          <strong className="text-[var(--text-primary)]">Conversion</strong>. Rename the
          middle two stages to match this client&apos;s pipeline — e.g.{" "}
          <em>Quote Sent</em> instead of <em>Booking</em>, or{" "}
          <em>Consult Scheduled</em> for an orthodontist. Use singular form.
        </p>
      </div>

      <form action={saveFunnelLabels} className="flex flex-col gap-5">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="clientSlug" value={clientSlug} />

        <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
          <LabelField
            name="funnel_label_booking"
            label="Stage 2"
            hint="Appointment booked"
            defaultValue={labels.funnel_label_booking}
          />
          <LabelField
            name="funnel_label_show"
            label="Stage 3"
            hint="Appointment held"
            defaultValue={labels.funnel_label_show}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <ResetForm disabled={!anyCustom} />
          <SubmitPrimary pendingLabel="Saving…">Save</SubmitPrimary>
        </div>
      </form>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers

const inputCls =
  "bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--ps-yellow)] w-full";

function LabelField({
  name,
  label,
  hint,
  defaultValue,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
        {label}
      </span>
      <input
        name={name}
        type="text"
        autoComplete="off"
        defaultValue={defaultValue}
        maxLength={32}
        className={inputCls}
      />
      <span className="text-[11px] text-[var(--text-tertiary)]">{hint}</span>
    </label>
  );
}

/**
 * "Reset to defaults" — same React 19 `formAction` override trick as the
 * Funnel Goals section. Reuses the parent form's hidden client inputs
 * so we don't need to nest <form>s (which React 19 flags as a hydration
 * error).
 */
function ResetForm({ disabled }: { disabled?: boolean }) {
  return (
    <SubmitLink
      tone="danger"
      pendingLabel="Resetting…"
      disabled={disabled}
      formAction={resetFunnelLabels}
    >
      Reset to defaults
    </SubmitLink>
  );
}
