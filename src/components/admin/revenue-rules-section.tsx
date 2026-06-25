/**
 * Per-client Revenue Rules admin section.
 *
 * Currently exposes ONE rule: revenue_per_show — a flat $/show
 * surcharge added to revenue for every appointment held. Useful for:
 *   - Sports clinics / chiropractors collecting an evaluation fee at
 *     every visit ($67 for St. Louis Sports Clinic)
 *   - Any business model where every show generates baseline revenue
 *     in addition to whatever the eventual converted patient pays
 *
 * 0 (the default) is a no-op — the dashboard returns the same revenue
 * as before (sum of converted opportunity lead_values). Any positive
 * number gets folded into revenue via the daily_metrics_v Postgres
 * view, so every downstream metric (revenue, ROAS, avg rev per X,
 * projection) picks it up automatically.
 *
 * The parent admin page only mounts this section when the client
 * already has a non-zero rule configured (so it stays hidden on
 * clients that don't need it). The initial value is passed in as a
 * prop — the admin page already fetched the row via resolveAccess
 * so we don't re-query here.
 *
 * Designed so we can drop additional rules in later (per-conversion
 * fees, per-lead bonuses, etc.) by adding a column + an input here.
 */
import { saveRevenueRules } from "./revenue-rules-actions";
import { SubmitPrimary } from "./submit-button";

type Props = {
  clientId: string;
  clientSlug: string;
  /** Current value from the clients row, passed down from the admin
   *  page (which already resolved the client). Avoids a second
   *  DB roundtrip just to populate one form field. */
  initialRevenuePerShow: number;
};

/** Display: drop trailing zeros so 67 renders as "67", not "67.00". */
function asDollarInput(v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (!Number.isFinite(v) || v === 0) return "";
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

export function RevenueRulesSection({ clientId, clientSlug, initialRevenuePerShow }: Props) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Revenue Rules</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Custom revenue rules that get folded into every period&apos;s totals.
          Leave at 0 if the client only earns revenue when an opportunity converts.
        </p>
      </div>

      <form action={saveRevenueRules} className="flex flex-col gap-5">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="clientSlug" value={clientSlug} />

        <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
          <RuleField
            name="revenue_per_show"
            label="Revenue per Show"
            hint="Flat $ added to revenue for every appointment held (e.g. consultation fee). Set to 0 to disable — the section disappears on next load."
            defaultValue={asDollarInput(initialRevenuePerShow)}
            prefix="$"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <SubmitPrimary pendingLabel="Saving…">Save</SubmitPrimary>
        </div>
      </form>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers

const inputCls =
  "bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--ps-yellow)] w-full font-mono tabular-nums";

function RuleField({
  name,
  label,
  hint,
  defaultValue,
  prefix,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string;
  /** Optional "$" affordance on the left edge of the input. */
  prefix?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
        {label}
      </span>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-tertiary)] pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
          placeholder="0"
          className={inputCls + (prefix ? " pl-7 pr-3 py-2" : " px-3 py-2")}
        />
      </div>
      <span className="text-[11px] text-[var(--text-tertiary)]">{hint}</span>
    </label>
  );
}
