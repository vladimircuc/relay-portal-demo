/**
 * Per-client Funnel Goals admin section.
 *
 * Three stage-to-stage conversion-rate targets:
 *   - Lead → Booking
 *   - Show rate (Shows / Bookings)
 *   - Show → Conversion (Conversions / Shows)
 *
 * Stored as decimals (0.7 = 70%) on the `clients` row. The form exposes
 * them as whole-number percents (the user types "70", not "0.7") because
 * that's how clients actually talk about funnel goals.
 *
 * When unset, the dashboard's funnel pill stays neutral grey. When set,
 * the pill turns green when the current rate meets-or-beats the goal
 * (only in "Stage to stage" mode — see funnel.tsx for the reasoning).
 */
import { createAdminClient } from "@/lib/supabase/server";
import { saveFunnelGoals, clearFunnelGoals } from "./funnel-goals-actions";
import { SubmitPrimary, SubmitLink } from "./submit-button";
import type { FunnelLabels } from "@/lib/auth";
import { pluralize } from "@/lib/funnel-labels";

type Props = {
  clientId: string;
  clientSlug: string;
  /** Per-client custom stage labels — drives the goal field titles
   *  (e.g. "Lead → Booking" becomes "Lead → Quote Sent" when the
   *  booking stage was renamed). */
  labels: FunnelLabels;
};

type GoalsRow = {
  goal_lead_to_booking: number | null;
  goal_show_rate: number | null;
  goal_show_to_conversion: number | null;
};

/** Decimal 0..1 → whole-number percent string for the input. NULL → "". */
function asPercentInput(d: number | null): string {
  if (d === null || d === undefined) return "";
  // Trim trailing .00 so 0.7 shows as "70", not "70.00"
  const pct = d * 100;
  return Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(2)));
}

export async function FunnelGoalsSection({ clientId, clientSlug, labels }: Props) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("clients")
    .select("goal_lead_to_booking, goal_show_rate, goal_show_to_conversion")
    .eq("id", clientId)
    .maybeSingle();

  const goals: GoalsRow = (data as GoalsRow | null) ?? {
    goal_lead_to_booking: null,
    goal_show_rate: null,
    goal_show_to_conversion: null,
  };

  const anySet =
    goals.goal_lead_to_booking !== null ||
    goals.goal_show_rate !== null ||
    goals.goal_show_to_conversion !== null;

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Funnel Goals</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Stage-to-stage conversion rate targets. The dashboard funnel turns the rate pill
          green when the current period meets or beats the goal, red when it falls short.
          Leave blank to unset.
        </p>
      </div>

      <form action={saveFunnelGoals} className="flex flex-col gap-5">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="clientSlug" value={clientSlug} />

        {/* Field labels stay singular ("Lead → Booking") — this is a
            stage-to-stage step name, not a count. Hints (numerator /
            denominator) are plural because they read as ratios of
            counts: "Bookings / Leads", "Shows / Bookings". */}
        <div className="grid gap-4 md:grid-cols-3">
          <GoalField
            name="leadToBooking"
            label={`Lead → ${labels.booking}`}
            hint={`${pluralize(labels.booking)} / Leads`}
            defaultValue={asPercentInput(goals.goal_lead_to_booking)}
          />
          <GoalField
            name="showRate"
            label={`${labels.show} rate`}
            hint={`${pluralize(labels.show)} / ${pluralize(labels.booking)}`}
            defaultValue={asPercentInput(goals.goal_show_rate)}
          />
          <GoalField
            name="showToConversion"
            label={`${labels.show} → Conversion`}
            hint={`Conversions / ${pluralize(labels.show)}`}
            defaultValue={asPercentInput(goals.goal_show_to_conversion)}
          />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <ClearForm disabled={!anySet} />
          <SubmitPrimary pendingLabel="Saving…">Save</SubmitPrimary>
        </div>
      </form>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers

const inputCls =
  "bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--ps-yellow)] w-full font-mono tabular-nums";

/**
 * Percent input with a trailing "%" affordance. Uses type="text" rather
 * than type="number" so we can accept "70%" or "70 " gracefully and
 * still get a clean string in the form payload. Numeric inputMode keeps
 * the mobile keyboard right.
 */
function GoalField({
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
      <div className="relative">
        <input
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
          placeholder="—"
          className={inputCls + " pr-8"}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-tertiary)] pointer-events-none">
          %
        </span>
      </div>
      <span className="text-[11px] text-[var(--text-tertiary)]">{hint}</span>
    </label>
  );
}

/**
 * "Clear all" button using React 19's `formAction` override — borrows
 * the parent form's clientId/clientSlug hidden inputs and routes to
 * clearFunnelGoals instead of saveFunnelGoals when clicked. Avoids
 * the nested-<form> hydration error a literal <form action={...}>
 * inside the parent form would produce.
 */
function ClearForm({ disabled }: { disabled?: boolean }) {
  return (
    <SubmitLink
      tone="danger"
      pendingLabel="Clearing…"
      disabled={disabled}
      formAction={clearFunnelGoals}
    >
      Clear all
    </SubmitLink>
  );
}
