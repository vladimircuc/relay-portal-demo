"use client";

/**
 * Advanced-tier projection: takes the current period's run-rate and
 * extrapolates it forward across a user-chosen horizon (6 / 9 /
 * 12 months). Visual style matches the Cost Efficiency + Revenue
 * Efficiency strips so the bottom of the dashboard reads as one
 * coherent series of 4-cell rows: same cell rhythm, same hairline
 * dividers, same number size, same centered alignment.
 *
 * Horizon math:
 *   - 12 months = 365 days (proper annualization)
 *   - 9 months  = 365 × 9/12 ≈ 274 days
 *   - 6 months  = 365 × 6/12 ≈ 183 days
 *
 *   target = (totalSoFar / currentPeriodDays) × horizonDays
 *
 * Client component because the horizon toggle is local UI state.
 * Server hands us the raw period totals; we own the run-rate math
 * so flipping the toggle is instant.
 */
import { useState } from "react";
import { Segmented } from "./ui/segmented";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import type { FunnelLabels } from "@/lib/auth";
import { pluralize } from "@/lib/funnel-labels";

type Props = {
  /** Current period length in days — used as the denominator for run-rate. */
  days: number;
  leads: number;
  bookings: number;
  conversions: number;
  revenue: number;
  /** Per-client stage labels — drives only the Booking cell. (The card
   *  collapses Show into Conversion for headline simplicity, so we only
   *  surface the customisable Booking label here.) */
  labels: FunnelLabels;
};

type Horizon = "6" | "9" | "12";

const HORIZON_OPTIONS: Array<{ value: Horizon; label: string }> = [
  { value: "6",  label: "6 months"  },
  { value: "9",  label: "9 months"  },
  { value: "12", label: "12 months" },
];

/** Days in the projected window. Use 365/12 as days-per-month so
 *  12mo → 365 exactly, and 6mo / 9mo land at clean fractions of that. */
function horizonDays(h: Horizon): number {
  const months = Number(h);
  return Math.round((365 / 12) * months);
}

function project(total: number, currentDays: number, targetDays: number): number {
  if (!currentDays) return 0;
  return (total / currentDays) * targetDays;
}

export function ProjectedCard({ days, leads, bookings, conversions, revenue, labels }: Props) {
  // Default to 12mo — full-year planning is the most common ask and
  // matches the old card's behaviour, so existing users see no change
  // until they flip the toggle.
  const [horizon, setHorizon] = useState<Horizon>("12");
  const targetDays = horizonDays(horizon);

  // Stage 1 + 4 are hardcoded plural for grammar ("Leads" /
  // "Conversions"); the Booking cell uses the per-client plural so
  // the row reads consistently ("LEADS · BOOKINGS · CONVERSIONS").
  const items = [
    { label: "Leads",                   value: formatNumber(project(leads,       days, targetDays)) },
    { label: pluralize(labels.booking), value: formatNumber(project(bookings,    days, targetDays)) },
    { label: "Conversions",             value: formatNumber(project(conversions, days, targetDays)) },
    { label: "Revenue",                 value: formatCurrency(project(revenue,   days, targetDays)) },
  ];

  return (
    <section className="bg-[var(--surface-3)]/40 rounded-[var(--radius-card)] border border-[var(--surface-3)]/40">
      <div className="bg-[var(--surface-1)] rounded-t-[var(--radius-card)] px-7 pt-6 pb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Projected
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-[11px] text-[var(--text-tertiary)] hidden sm:inline">
            If current pace holds for {targetDays} days
          </div>
          <Segmented<Horizon>
            value={horizon}
            options={HORIZON_OPTIONS}
            onChange={setHorizon}
            size="sm"
          />
        </div>
      </div>

      {/* Mobile stacks; md+ is a 4-column flex row with 1px gap dividers.
          Matches EfficiencyStrip cell-for-cell so the three strips at
          the bottom of the dashboard line up. */}
      <div className="grid grid-cols-1 gap-px bg-[var(--surface-3)]/40 md:flex">
        {items.map((it, i) => (
          <div
            key={it.label}
            className={cn(
              // Tighter than EfficiencyStrip on purpose: those strips
              // have a Delta indicator sitting below the value, so the
              // mt-auto layout fills naturally. This card has nothing
              // below the value — drop mt-auto + min-h and let the
              // cell size to content so label and number sit close.
              "relative bg-[var(--surface-1)] px-4 py-4 md:flex-1 md:px-7 md:py-5 flex flex-col gap-2.5 items-center",
              i < items.length - 1 && "md:mr-px",
              // Match Cost Efficiency: round the corners that touch the
              // section's rounded edges so we don't need overflow-hidden
              // (which would clip popovers later if any were added).
              i === 0 && "md:rounded-bl-[var(--radius-card)]",
              i === items.length - 1 && "md:rounded-br-[var(--radius-card)]",
            )}
          >
            <div className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider">
              {it.label}
            </div>
            <div className="text-[28px] leading-none font-bold tabular-nums tracking-tight text-[var(--text-primary)]">
              {it.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
