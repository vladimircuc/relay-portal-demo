"use client";

/**
 * Source breakdown card — donut + ranked list, with a toggle between
 * three modes:
 *
 *   Leads    — count of opps per source
 *   Revenue  — sum of monetary_value (converted-stage opps only)
 *   ROAS     — revenue ÷ allocated spend per source (advanced tier only)
 *
 * ROAS mode handles a quirk: ROAS doesn't sum like the other two
 * (you can't sum multipliers and get a meaningful total). So in ROAS
 * mode the donut is still sized by REVENUE — the slice shape is
 * identical to Revenue mode, only the per-source labels swap to
 * showing the multiplier. The centre shows the aggregate ROAS
 * (total revenue ÷ total spend).
 *
 * Interaction:
 *   - Hovering a slice (donut or list row) dims the others and the
 *     centre swaps to the hovered slice's value + revenue share.
 *   - Hover is gated by useSupportsHover so taps on touch devices
 *     don't leave the dimmed-others styling stuck.
 */
import { useEffect, useRef, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/cn";
import { formatCurrency, formatMultiplier, formatNumber, formatPercent } from "@/lib/formatters";
import type { SourceBucket } from "@/lib/sources";
import { Segmented } from "./ui/segmented";
import { useViewMode } from "./view-mode-context";
import { useTier } from "./tier-context";
import { useSupportsHover } from "./use-supports-hover";
import { useChartColors } from "./use-chart-colors";

type Mode = "leads" | "revenue" | "roas" | "lost";

type Props = {
  leadBuckets: SourceBucket[];
  /** Real (closed-only) revenue buckets — what we'd render in Real mode. */
  revenueBuckets: SourceBucket[];
  /** Projected revenue buckets — actual closed PLUS each source's
   *  outstanding × historical rates added in. Equals revenueBuckets
   *  when canProject is false. */
  projectedRevenueBuckets: SourceBucket[];
  /** ROAS per source = bucket.revenue / allocated_spend. Same length +
   *  order as revenueBuckets so donut slices match up. Bucket.value
   *  carries the ROAS multiplier; bucket.share carries the original
   *  REVENUE share (kept so donut sizing is by revenue, not ROAS). */
  roasBuckets: SourceBucket[];
  projectedRoasBuckets: SourceBucket[];
  /** Total period spend (drives the centre aggregate ROAS). */
  totalSpend: number;
  /** False when there isn't enough rate-window history to project. */
  canProject: boolean;
  /** Lost-leads-by-reason buckets — one slice per reason, NO "Other" rollup
   *  and no cap (every reason with ≥1 lost lead shows). Empty unless the
   *  client is allowlisted for the feature. */
  lostBuckets?: SourceBucket[];
  /** Gates the "Lost" toggle (advanced tier + per-client allowlist). */
  lostEnabled?: boolean;
};

export function SourceBreakdown({
  leadBuckets,
  revenueBuckets,
  projectedRevenueBuckets,
  roasBuckets,
  projectedRoasBuckets,
  totalSpend,
  canProject,
  lostBuckets = [],
  lostEnabled = false,
}: Props) {
  const [mode, setMode] = useState<Mode>("leads");
  const [hover, setHover] = useState<number | null>(null);
  // Lost mode can overflow the donut's height (no cap on reasons). We let the
  // list scroll and show a bottom fade hint until the user reaches the end.
  const listRef = useRef<HTMLUListElement>(null);
  const [showFade, setShowFade] = useState(false);
  const { viewMode } = useViewMode();
  const { tier } = useTier();
  // Theme-aware palettes (read from CSS vars; swaps on light/dark toggle).
  const { ramp, other, lost } = useChartColors();
  const isProjected = viewMode === "projected" && canProject;
  // Touch devices don't get hover-driven slice dimming / row
  // highlighting — without this gate, tapping a slice would set the
  // hover state and the dimmed-others styling would stick.
  const supportsHover = useSupportsHover();
  const onEnter = supportsHover ? (i: number) => setHover(i) : () => {};
  const onLeave = supportsHover ? () => setHover(null) : () => {};

  // ── Pick the active bucket sets ─────────────────────────────────────────
  // The DONUT is always sized by the active mode's `value` EXCEPT in
  // ROAS mode, where it falls back to revenue sizing (ROAS multipliers
  // don't "sum" sensibly, so sizing by them would produce a misleading
  // shape — bigger slice ≠ more impact).
  const activeRevenue = isProjected ? projectedRevenueBuckets : revenueBuckets;
  const activeRoas = isProjected ? projectedRoasBuckets : roasBuckets;

  const listBuckets =
    mode === "leads"   ? leadBuckets :
    mode === "revenue" ? activeRevenue :
    mode === "roas"    ? activeRoas :
    /* lost */           lostBuckets;

  // For ROAS, donut slices are sized by REVENUE (parallel array, same
  // order/labels). For Leads, Revenue and Lost, donut + list share buckets.
  const donutBuckets = mode === "roas" ? activeRevenue : listBuckets;

  // Source modes (Leads/Revenue/ROAS) use the sequential ramp + an "Other"
  // rollup colour. "Lost" mode uses its own wider categorical palette (cycling)
  // since it has no "Other" rollup and no slice cap. Both come from
  // useChartColors so they track the active theme.
  const colorFor = (index: number, isOther: boolean): string =>
    isOther ? other : (ramp[index] ?? ramp[ramp.length - 1]);
  const sliceColor = (index: number, isOther: boolean): string =>
    mode === "lost" ? lost[index % lost.length] : colorFor(index, isOther);

  const listTotal = listBuckets.reduce((acc, b) => acc + b.value, 0);
  const revenueTotal = activeRevenue.reduce((acc, b) => acc + b.value, 0);

  // ── Mode-aware formatters + labels ──────────────────────────────────────
  const formatValue = (v: number): string => {
    if (mode === "leads") return formatNumber(v);
    if (mode === "revenue") return formatCurrency(v, 0);
    if (mode === "lost") return formatNumber(v); // count of lost leads
    return formatMultiplier(v, v < 10 ? 2 : 1); // ROAS: 4.21× / 12.5×
  };
  // Aggregate value shown in the donut centre when no slice is hovered.
  // For Leads / Revenue it's the simple sum; for ROAS it's the global
  // ratio (sum of revenue / sum of spend), which is the only honest
  // "aggregate" — averaging per-source ROAS would mis-weight small
  // sources against large ones.
  const aggregateValue =
    mode === "roas"
      ? (totalSpend > 0 ? revenueTotal / totalSpend : 0)
      : listTotal;

  const centerCaption =
    mode === "leads"   ? "Opportunities"
    : mode === "revenue" ? (isProjected ? "Projected Revenue" : "Total Revenue")
    : mode === "roas"    ? (isProjected ? "Projected ROAS"      : "Overall ROAS")
    : /* lost */         "Leads Lost";
  const cardTitle =
    mode === "leads"   ? "Leads by Source"
    : mode === "revenue" ? (isProjected ? "Projected Revenue by Source" : "Revenue by Source")
    : mode === "roas"    ? (isProjected ? "Projected ROAS by Source"      : "ROAS by Source")
    : /* lost */         "Lost Leads by Reason";
  // Yellow underline applies when we're showing projected numbers
  // (revenue or roas). Leads never projects.
  const showProjectedDecoration =
    isProjected && (mode === "revenue" || mode === "roas");
  const projectedDecoration = showProjectedDecoration
    ? "underline decoration-[var(--ps-yellow)] decoration-2 underline-offset-[5px]"
    : "";

  const hovered = hover !== null ? listBuckets[hover] : null;
  // Each list bucket's "share of total" displayed on the right edge.
  // For Leads / Revenue this is share of the active metric. For ROAS
  // we surface the source's REVENUE share — multipliers don't have a
  // "share" concept, and the donut is sized by revenue anyway, so
  // revenue share is what the donut slice's size actually represents.
  const shareFor = (i: number): number =>
    mode === "roas"
      ? (activeRevenue[i]?.share ?? 0)
      : (listBuckets[i]?.share ?? 0);

  // Show the bottom fade only while the list actually overflows AND we're not
  // already scrolled to the end. Recomputes on mode change (Lost can have many
  // rows), on scroll, and on resize. Desktop-only: the scroll cap is `md:`,
  // and on mobile the list flows full-height (no cap, no fade needed).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const overflowing = el.scrollHeight > el.clientHeight + 1;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      setShowFade(overflowing && !atBottom);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [mode, isProjected, listBuckets.length]);

  // Toggle options — ROAS and Lost are advanced-tier only. Lost is
  // additionally gated per-client (lostEnabled) since it's an opt-in feature.
  const toggleOptions: { value: Mode; label: string }[] = [
    { value: "leads",   label: "Leads"   },
    { value: "revenue", label: "Revenue" },
  ];
  if (tier === "advanced") {
    toggleOptions.push({ value: "roas", label: "ROAS" });
    if (lostEnabled) toggleOptions.push({ value: "lost", label: "Lost" });
  }

  return (
    <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7">
      <div className="flex items-center justify-between mb-6">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          {cardTitle}
        </div>
        <Segmented<Mode>
          value={mode}
          options={toggleOptions}
          onChange={(v) => {
            setHover(null);
            setMode(v);
          }}
          size="sm"
        />
      </div>

      {listTotal === 0 ? (
        <div className="min-h-[260px] flex items-center justify-center text-[var(--text-tertiary)] text-sm">
          {mode === "leads"
            ? "No opportunities in this period"
            : mode === "revenue"
              ? "No revenue tracked in this period"
              : mode === "lost"
                ? "No lost leads in this period"
                : totalSpend === 0
                  ? "No spend tracked in this period"
                  : "No revenue tracked yet — ROAS is 0 across the board"}
        </div>
      ) : (
        <div className="flex flex-col gap-6 md:grid md:grid-cols-[1fr_1.4fr] md:gap-10 md:items-center">
          {/* Donut + center label. Fluid width on mobile (caps at 280px)
              so a narrow phone doesn't get a 280px square in a 375px
              container. Square aspect ratio keeps it circular. */}
          <div
            className="relative mx-auto w-full max-w-[280px] aspect-square"
            onMouseLeave={onLeave}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutBuckets.map((b, i) => ({
                    name: b.label,
                    value: b.value,
                    color: sliceColor(i, !!b.isOther),
                  }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  // Percentage radii (not fixed px) so the donut SCALES with its
                  // square container instead of overflowing + getting clipped on
                  // the sides when the column is narrower than ~260px. Matches the
                  // socials content-mix donut.
                  innerRadius="62%"
                  outerRadius="96%"
                  paddingAngle={2}
                  stroke="var(--surface-1)"
                  strokeWidth={3}
                  isAnimationActive={false}
                  onMouseEnter={(_, idx) => onEnter(idx)}
                >
                  {donutBuckets.map((b, i) => (
                    <Cell
                      key={i}
                      fill={sliceColor(i, !!b.isOther)}
                      fillOpacity={hover === null || hover === i ? 1 : 0.35}
                      style={{ cursor: "pointer", transition: "fill-opacity 150ms ease" }}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6 text-center">
              {hovered ? (
                <>
                  <div className={cn(
                    "text-[28px] font-bold tabular-nums leading-none text-[var(--text-primary)]",
                    projectedDecoration,
                  )}>
                    {formatValue(hovered.value)}
                  </div>
                  <div className="text-[11px] tabular-nums text-[var(--text-secondary)] mt-2">
                    {formatPercent(shareFor(hover ?? 0))} of total
                  </div>
                </>
              ) : (
                <>
                  <div className={cn(
                    "text-[28px] font-bold tabular-nums leading-none text-[var(--text-primary)]",
                    projectedDecoration,
                  )}>
                    {formatValue(aggregateValue)}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] mt-2">
                    {centerCaption}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Source list — caps height on desktop and scrolls; a bottom fade
              hints there's more below (mainly for the un-capped "Lost" mode,
              which can list every reason with no "Other" rollup). */}
          <div className="relative min-w-0">
          <ul
            ref={listRef}
            className="flex flex-col gap-0 divide-y divide-[var(--surface-3)]/40 md:max-h-[300px] md:overflow-y-auto md:pr-2 md:[scrollbar-width:thin] md:[scrollbar-color:var(--surface-3)_transparent]"
            onMouseLeave={onLeave}
          >
            {listBuckets.map((b, i) => (
              <li
                key={`${b.label}-${i}`}
                onMouseEnter={() => onEnter(i)}
                className={cn(
                  "grid grid-cols-[10px_1fr_auto_auto] items-center gap-3 py-2.5 px-2 -mx-2 rounded-md cursor-default transition-colors",
                  hover === i ? "bg-[var(--surface-2)]" : "",
                )}
                title={
                  b.isOther && b.rolledUp
                    ? `Other includes: ${b.rolledUp.slice(0, 6).join(", ")}${b.rolledUp.length > 6 ? "…" : ""}`
                    : b.raw ?? undefined
                }
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full transition-opacity"
                  style={{
                    background: sliceColor(i, !!b.isOther),
                    opacity: hover === null || hover === i ? 1 : 0.4,
                  }}
                />
                <span
                  className={cn(
                    "text-sm truncate transition-colors",
                    hover === null || hover === i ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]",
                  )}
                >
                  {b.label}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums transition-colors",
                    hover === null || hover === i ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]",
                    projectedDecoration,
                  )}
                >
                  {formatValue(b.value)}
                </span>
                <span className="text-xs tabular-nums text-[var(--text-tertiary)] w-12 text-right">
                  {formatPercent(shareFor(i))}
                </span>
              </li>
            ))}
          </ul>
          {/* Bottom fade — shown only while the list overflows and isn't
              scrolled to the end. Matches the card background so rows appear
              to dissolve. Desktop-only (mobile list isn't height-capped). */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 hidden h-12 bg-gradient-to-t from-[var(--surface-1)] to-transparent transition-opacity duration-200 md:block",
              showFade ? "opacity-100" : "opacity-0",
            )}
          />
          </div>
        </div>
      )}
    </div>
  );
}
