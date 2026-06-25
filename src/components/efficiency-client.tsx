"use client";

/**
 * Cost + Revenue Efficiency strips, tier- and view-mode-aware.
 *
 *   Simple    → Cost Efficiency only.
 *   Advanced  → Cost Efficiency + Revenue Efficiency stacked beneath it.
 *   Mobile    → Cost Efficiency only, regardless of tier.
 *
 * View modes:
 *   Real      → uses the actual aggregates (current period totals).
 *   Projected → uses the projected aggregates (current + outstanding
 *               × historical rates rolled forward). Cells whose values
 *               actually differ between modes get a yellow underline
 *               on the value text so they read as projected at a
 *               glance.
 *
 * Server pre-computes both real and projected item shapes; this
 * component just picks based on the active modes — no re-fetch on toggle.
 */
import { useTier } from "./tier-context";
import { useViewMode } from "./view-mode-context";
import { EfficiencyStrip, type EfficiencyItem } from "./efficiency-strip";

export function EfficiencyClient({
  costItems,
  revenueItems,
  projectedCostItems,
  projectedRevenueItems,
  canProject,
}: {
  costItems: EfficiencyItem[];
  revenueItems: EfficiencyItem[];
  /** Same shape, projected variants. Items whose value is identical
   *  to the real version should set `projected: false` so they don't
   *  get the underline (e.g. CPL doesn't actually change in projected
   *  mode, since neither spend nor leads project). */
  projectedCostItems: EfficiencyItem[];
  projectedRevenueItems: EfficiencyItem[];
  /** False when there isn't enough rate-window history to project. */
  canProject: boolean;
}) {
  const { tier } = useTier();
  const { viewMode } = useViewMode();
  const isProjected = viewMode === "projected" && canProject;

  const cost = isProjected ? projectedCostItems : costItems;
  const revenue = isProjected ? projectedRevenueItems : revenueItems;

  return (
    <div className="flex flex-col gap-6">
      <EfficiencyStrip title="Cost Efficiency" items={cost} align="center" />

      {/* Revenue Efficiency: Advanced + desktop only. */}
      {tier === "advanced" && (
        <div className="hidden md:block">
          <EfficiencyStrip title="Revenue Efficiency" items={revenue} align="center" />
        </div>
      )}
    </div>
  );
}
