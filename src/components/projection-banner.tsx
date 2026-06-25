"use client";

/**
 * Yellow-tinted banner that appears at the top of the dashboard when
 * the view mode is `projected`. Surfaces:
 *   - The outstanding count being projected forward
 *   - The historical rates being applied
 *   - The window those rates came from (last N days)
 *   - A "How this is calculated" link that opens a full explainer
 *     modal (ProjectionExplainer)
 *
 * Goal: make the math visible. A client looking at projected revenue
 * should be able to glance at this banner and verify the assumptions —
 * "we're rolling 47 outstanding × 68% show × 22% close × $4,200 avg."
 *
 * When in real mode, renders nothing.
 *
 * When projection isn't possible (e.g. window has zero conversions, so
 * close_rate / avg_rev are null), surfaces a quieter "can't project"
 * variant explaining why.
 */
import { useState } from "react";
import { Sparkles, AlertCircle, HelpCircle } from "lucide-react";
import { useViewMode } from "./view-mode-context";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/formatters";
import type { ProjectionRates } from "@/lib/projection";
import { ProjectionExplainer } from "./projection-explainer";
import type { FunnelLabels } from "@/lib/auth";

type Props = {
  /** Outstanding appointments from the displayed period (the count
   *  being rolled forward). */
  outstanding: number;
  /** Stable rates fetched from the 90-day-or-max window. */
  rates: ProjectionRates;
  /** Per-client stage labels — drives the rate-summary labels
   *  ("Show rate" → "{labels.show} rate"). */
  labels: FunnelLabels;
};

export function ProjectionBanner({ outstanding, rates, labels }: Props) {
  const { viewMode } = useViewMode();
  const [explainerOpen, setExplainerOpen] = useState(false);
  if (viewMode !== "projected") return null;

  const canProject =
    rates.show_rate !== null &&
    rates.close_rate !== null &&
    rates.avg_revenue_per_conversion !== null;

  if (!canProject) {
    return (
      <section className="bg-[var(--surface-2)]/60 border border-[var(--surface-3)] rounded-[var(--radius-card)] px-5 py-4 flex items-start gap-3">
        <AlertCircle size={18} className="text-[var(--text-tertiary)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)]">
            Not enough history to project yet
          </div>
          <div className="text-[12px] text-[var(--text-secondary)] mt-1">
            We need at least one converted appointment over the last{" "}
            {rates.windowDays} days to compute a projection. Toggle off to see actuals.
          </div>
        </div>
      </section>
    );
  }

  // canProject is true ⇒ all three rates are non-null. Narrow for TS.
  const showRate = rates.show_rate as number;
  const closeRate = rates.close_rate as number;
  const avgRev = rates.avg_revenue_per_conversion as number;
  const projectedAddedRevenue =
    outstanding * showRate * closeRate * avgRev;

  return (
    <section
      role="status"
      className="bg-[var(--ps-yellow)]/10 border border-[var(--ps-yellow)]/40 rounded-[var(--radius-card)] px-5 py-4 flex items-start gap-3 flex-wrap"
    >
      <Sparkles size={18} className="text-[var(--accent-fg)] shrink-0 mt-0.5" />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)]">
          Projected view
          <span className="text-[var(--text-tertiary)] font-normal ml-2">
            · adds ≈ {formatCurrency(projectedAddedRevenue, 0)} of projected revenue
          </span>
        </div>
        <div className="text-[12px] text-[var(--text-secondary)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            <strong className="text-[var(--text-primary)] tabular-nums">{formatNumber(outstanding)}</strong>{" "}
            outstanding rolled forward
          </span>
          <span>·</span>
          <span>
            {labels.show} rate{" "}
            <strong className="text-[var(--text-primary)] tabular-nums">{formatPercent(showRate)}</strong>
          </span>
          <span>·</span>
          <span>
            Close rate{" "}
            <strong className="text-[var(--text-primary)] tabular-nums">{formatPercent(closeRate)}</strong>
          </span>
          <span>·</span>
          <span>
            Avg/conv{" "}
            <strong className="text-[var(--text-primary)] tabular-nums">{formatCurrency(avgRev, 0)}</strong>
          </span>
          <span>·</span>
          <span className="text-[var(--text-tertiary)]">
            based on last {rates.windowDays} days
          </span>
        </div>
      </div>

      {/* How-this-is-calculated trigger. Sits on the right edge so it
          doesn't interrupt the rates row when there's room, drops
          below on narrow screens via flex-wrap on the parent. */}
      <button
        type="button"
        onClick={() => setExplainerOpen(true)}
        className="shrink-0 inline-flex items-center gap-1.5 text-[12px] text-[var(--accent-fg)] underline-offset-2 hover:underline transition-colors"
      >
        <HelpCircle size={14} />
        How this is calculated
      </button>

      {explainerOpen && (
        <ProjectionExplainer
          outstanding={outstanding}
          showRate={showRate}
          closeRate={closeRate}
          avgRevPerConversion={avgRev}
          windowDays={rates.windowDays}
          labels={labels}
          onClose={() => setExplainerOpen(false)}
        />
      )}
    </section>
  );
}
