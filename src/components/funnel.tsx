"use client";

/**
 * Pipeline funnel — single compact SVG with 4 trapezoid paths, side info on
 * the right.
 *
 * Three features layered in:
 *
 *   1. Outstanding Appointments — bookings minus no-shows minus shows.
 *      Rendered as a small sub-line under the Bookings count so it's
 *      visible without dominating the layout. Useful for clients with
 *      long sales cycles (Varble: orthodontics consultations can sit
 *      booked for weeks).
 *
 *   2. Rate-mode toggle — "Absolute" (default, each rate is a fraction of
 *      top-of-funnel leads — a fixed reference) vs "Relative" (each pill
 *      shows the conversion from the PREVIOUS stage). Relative is the
 *      industry-standard view for funnel optimization since each number
 *      is independently actionable.
 *
 *   3. Goal coloring — when the client has set per-stage rate goals in
 *      admin (#5), the rate pill turns green when the current rate meets
 *      or beats the goal, red when it falls short. Only colored in
 *      Relative mode (goals are defined against stage-to-stage rates,
 *      not lead-relative rates).
 *
 * GEOMETRY: each corner curve's endpoint must sit ON the slanted edge,
 * not directly below the corner — otherwise the path makes a
 * "straight then bend" artifact at every corner. We compute a unit
 * vector along each slant and place curve endpoints R units down the
 * slant. That makes the curve tangent to the slant, smooth transition.
 */
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatNumber, formatPercent, safeDiv } from "@/lib/formatters";
import { Segmented } from "./ui/segmented";
import { Delta } from "./delta";
import { useViewMode } from "./view-mode-context";
import { useSupportsHover } from "./use-supports-hover";
import type { FunnelLabels } from "@/lib/auth";
import { pluralize } from "@/lib/funnel-labels";

export type FunnelGoals = {
  /** Bookings / Leads */
  lead_to_booking?: number | null;
  /** Shows / Bookings */
  show_rate?: number | null;
  /** Conversions / Shows */
  show_to_conversion?: number | null;
};

export type FunnelCounts = {
  leads: number;
  bookings: number;
  shows: number;
  conversions: number;
  outstanding: number;
  /** Booked appointments that didn't show. Rendered as a small sub-line
   *  under the Shows count (mirrors "outstanding" under Bookings). */
  no_shows: number;
};

type Props = {
  /** Real actuals. */
  real: FunnelCounts;
  /** Projected variant — shows/conversions inflate by outstanding × rates,
   *  outstanding drops to 0. Same shape, different values. */
  projected: FunnelCounts;
  /** False when there isn't enough rate-window history to compute a
   *  projection; in that case Projected mode silently shows real values. */
  canProject: boolean;
  /** Week-over-week change in leads vs the prior period (fraction, e.g. 0.12 =
   *  +12%). Shown as a delta pill on the Leads stage. null when there's no
   *  comparable prior period. */
  leadsDelta?: number | null;
  /** Optional per-stage rate goals (decimals, e.g. 0.7 = 70%). */
  goals?: FunnelGoals;
  /** Per-client custom stage labels (singular). Drives every "Lead /
   *  Booking / Show / Conversion" surface in this component. */
  labels: FunnelLabels;
};

const VW = 260;
const STAGE_H = 56;
const GAP = 12;
const TOTAL_H = STAGE_H * 4 + GAP * 3;
const R = 10;

// Each stage's bottom width matches the next stage's top width — visually
// continuous funnel silhouette with small gaps between blocks.
const SHAPES = [
  { topW: 240, bottomW: 188 },
  { topW: 188, bottomW: 140 },
  { topW: 140, bottomW: 92  },
  { topW: 92,  bottomW: 48  },
];

const COLORS = ["#ff7a2f", "#ff5a1e", "#f0421e", "#d62a18"];

type RateMode = "of_leads" | "stage_to_stage";

/** Funnel-count formatter.
 *
 * Projected mode rolls the outstanding pipeline forward at historical rates, so
 * the projecting stages carry FRACTIONAL expected values (3 outstanding × 50%
 * show × 25% close = 1.5 shows, 1.5 no-shows, 0.4 conversions). The rate pills
 * and the projected revenue/ROAS are all derived from those fractions, so
 * rounding the COUNT to a whole number made the funnel contradict itself —
 * "0 conversions" sitting next to a 0.7% close rate and $2,651 of projected
 * revenue, and shows(2)+no-shows(2) overflowing 3 bookings. We render one
 * decimal whenever a count isn't whole (real/actual counts are always integers,
 * so they're unaffected). Round to 1 dp first so float noise like 3.0000001
 * still prints "3", not "3.0". */
function fmtCount(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? formatNumber(r) : formatNumber(r, 1);
}

function trapezoidPath(stage: number): string {
  const s = SHAPES[stage];
  const topInset    = (VW - s.topW)    / 2;
  const bottomInset = (VW - s.bottomW) / 2;
  const topY = stage * (STAGE_H + GAP);
  const botY = topY + STAGE_H;
  const tl = topInset;
  const tr = VW - topInset;
  const bl = bottomInset;
  const br = VW - bottomInset;

  const rDx = br - tr;
  const rDy = botY - topY;
  const rLen = Math.sqrt(rDx * rDx + rDy * rDy);
  const rUx = rDx / rLen;
  const rUy = rDy / rLen;

  const lDx = bl - tl;
  const lDy = botY - topY;
  const lLen = Math.sqrt(lDx * lDx + lDy * lDy);
  const lUx = lDx / lLen;
  const lUy = lDy / lLen;

  const trEndX = tr + R * rUx;
  const trEndY = topY + R * rUy;
  const brStartX = br - R * rUx;
  const brStartY = botY - R * rUy;
  const blEndX = bl - R * lUx;
  const blEndY = botY - R * lUy;
  const tlStartX = tl + R * lUx;
  const tlStartY = topY + R * lUy;

  const f = (n: number) => n.toFixed(2);

  return [
    `M ${tl + R} ${topY}`,
    `L ${tr - R} ${topY}`,
    `Q ${tr} ${topY} ${f(trEndX)} ${f(trEndY)}`,
    `L ${f(brStartX)} ${f(brStartY)}`,
    `Q ${br} ${botY} ${br - R} ${botY}`,
    `L ${bl + R} ${botY}`,
    `Q ${bl} ${botY} ${f(blEndX)} ${f(blEndY)}`,
    `L ${f(tlStartX)} ${f(tlStartY)}`,
    `Q ${tl} ${topY} ${tl + R} ${topY}`,
    "Z",
  ].join(" ");
}

export function Funnel({ real, projected, canProject, leadsDelta, goals, labels }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState<RateMode>("of_leads");
  const { viewMode } = useViewMode();
  // Only render the projected variant when the toggle is on AND
  // we actually have a projection. Otherwise silently use real.
  const isProjected = viewMode === "projected" && canProject;
  // Touch devices skip the "lift the trapezoid on hover" effect — on
  // tap it would stick until the user tapped elsewhere, looking
  // broken. We don't render any tap-driven highlight on touch; the
  // numbers + rates carry the funnel on mobile.
  const supportsHover = useSupportsHover();
  const onCellEnter = supportsHover ? (i: number) => setHover(i) : () => {};
  const onCellLeave = supportsHover ? () => setHover(null) : () => {};

  // Pick the active counts up front; everything below reads from these
  // single names without needing to know which view mode is active.
  const { leads, bookings, shows, conversions, outstanding, no_shows } =
    isProjected ? projected : real;

  // Compute both rate sets up front so toggling is instant.
  const ofLeads = {
    bookings:    safeDiv(bookings,    leads),
    shows:       safeDiv(shows,       leads),
    conversions: safeDiv(conversions, leads),
  };
  const stageToStage = {
    bookings:    safeDiv(bookings,    leads),     // Same first hop
    shows:       safeDiv(shows,       bookings),  // shows / bookings = show rate
    conversions: safeDiv(conversions, shows),     // conversions / shows = close rate
  };

  // Goals attach to stage-to-stage (Relative) rates conceptually. We
  // compute "goal hit?" off stage-to-stage rates even when displaying
  // Absolute values — but we only PAINT the color in Relative mode,
  // otherwise an Absolute rate that's lower than the goal would look red
  // without being a comparable number. Less confusing to only color when
  // the displayed % is the same as the goal-comparable %.
  const showColors = mode === "stage_to_stage";
  const goalForStage = {
    bookings:    goals?.lead_to_booking    ?? null,
    shows:       goals?.show_rate          ?? null,
    conversions: goals?.show_to_conversion ?? null,
  };

  // Stage 1 + 4 are hardcoded plural ("Leads", "Conversions"); stages
  // 2 + 3 plural via `pluralize` (adds 's' after the first word — so
  // "Booking" → "Bookings", "Quote Sent" → "Quotes Sent"). The side
  // info label is a category badge that reads naturally in plural.
  const stages = [
    { key: "leads",       label: "Leads",                    count: leads,       rate: null as number | null, goal: null as number | null },
    { key: "bookings",    label: pluralize(labels.booking),  count: bookings,    rate: (mode === "of_leads" ? ofLeads.bookings    : stageToStage.bookings),    goal: goalForStage.bookings    },
    { key: "shows",       label: pluralize(labels.show),     count: shows,       rate: (mode === "of_leads" ? ofLeads.shows       : stageToStage.shows),       goal: goalForStage.shows       },
    { key: "conversions", label: "Conversions",              count: conversions, rate: (mode === "of_leads" ? ofLeads.conversions : stageToStage.conversions), goal: goalForStage.conversions },
  ];

  // Consistent min-width for the count column so pills line up regardless
  // of digit count — sized to the WIDEST formatted count (a projected "1.5"
  // is wider than an integer "57"), so a fractional projected value doesn't
  // misalign the column.
  const countWidth = `${Math.max(...[leads, bookings, shows, conversions].map((c) => fmtCount(c).length))}ch`;

  // Stage labels + counts for the mobile-only in-trapezoid text
  // overlay. Just the count and a short label — no percentages on
  // mobile so the narrow bottom trapezoid stays readable.
  //
  // Top stage uses plural "Leads" (Lead is hardcoded). Bottom stage
  // uses "Conv." — the bottom trapezoid is only ~70px wide at its
  // center, so we abbreviate "Conversions" rather than letting it
  // overflow. Middle two use the per-client plural so the mobile
  // funnel reads consistently ("BOOKINGS", "QUOTES SENT") with the
  // top/bottom labels. Long custom labels may render cramped on
  // narrower phones — known tradeoff.
  const mobileStages = [
    { label: "Leads",                   count: leads },
    { label: pluralize(labels.booking), count: bookings },
    { label: pluralize(labels.show),    count: shows },
    { label: "Conv.",                   count: conversions },
  ];

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Pipeline Funnel
        </div>
        {/* Absolute/Relative toggle is desktop-only. Mobile shows only
            the absolute view, baked into the SVG itself. */}
        <div className="hidden md:block">
          <Segmented<RateMode>
            value={mode}
            options={[
              { value: "of_leads",        label: "Absolute" },
              { value: "stage_to_stage",  label: "Relative" },
            ]}
            onChange={setMode}
            size="sm"
          />
        </div>
      </div>

      <div
        // Mobile: just the SVG, full width. Desktop: 2-column grid
        // with SVG on the left and the side-info column on the right.
        className="grid grid-cols-1 md:grid-cols-[minmax(0,260px)_auto] gap-5 md:gap-8 items-center md:w-fit"
        onMouseLeave={onCellLeave}
      >
        {/* Funnel SVG. */}
        <div className="flex justify-center w-full">
          <svg
            width="100%"
            height="auto"
            viewBox={`0 0 ${VW} ${TOTAL_H}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ overflow: "visible", maxWidth: VW }}
          >
            {stages.map((s, i) => {
              const color = COLORS[i];
              const isHover = hover === i;
              return (
                <path
                  key={s.key}
                  d={trapezoidPath(i)}
                  fill={color}
                  onMouseEnter={() => onCellEnter(i)}
                  style={{
                    filter: isHover
                      ? `brightness(1.15) drop-shadow(0 6px 14px ${color}99)`
                      : "brightness(1)",
                    transition: "filter 200ms ease",
                    cursor: "default",
                  }}
                />
              );
            })}

            {/* Mobile-only in-trapezoid text overlay. SVG <text> with
                a Tailwind md:hidden class — desktop renders only the
                shapes (numbers live in the side-info column), mobile
                puts label + count ON the funnel since the side
                column is hidden. No percentages here — keeps the
                narrow bottom trapezoid readable. */}
            {mobileStages.map((s, i) => {
              const yStart = i * (STAGE_H + GAP);
              const labelY = yStart + 20;
              const valueY = yStart + 42;
              return (
                <g key={`mlabel-${s.label}`} className="md:hidden">
                  <text
                    x={VW / 2}
                    y={labelY}
                    textAnchor="middle"
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: "0.08em",
                      fill: "#000",
                      opacity: 0.55,
                    }}
                  >
                    {s.label.toUpperCase()}
                  </text>
                  <text
                    x={VW / 2}
                    y={valueY}
                    textAnchor="middle"
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      fill: "#000",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtCount(s.count)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Side info — desktop only. Mobile gets the numbers baked
            into the SVG above; rendering this column too would just
            duplicate them. */}
        <div className="hidden md:flex flex-col" style={{ gap: GAP }}>
          {stages.map((s, i) => {
            const isHover = hover === i;
            const isBookings = s.key === "bookings";
            const isShows = s.key === "shows";
            // Decide the rate pill's color based on goal comparison —
            // only when we're in stage-to-stage mode AND the client has
            // set a goal for this stage.
            const goalHit =
              showColors && s.goal !== null && s.rate !== null
                ? s.rate >= s.goal
                : null;
            return (
              <div
                key={s.key}
                className="flex flex-col justify-center gap-1"
                style={{ height: STAGE_H }}
                onMouseEnter={() => onCellEnter(i)}
              >
                <div
                  className={cn(
                    "text-[10px] uppercase tracking-wider transition-colors",
                    isHover ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
                  )}
                >
                  {s.label}
                </div>
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "text-[24px] leading-none font-bold tabular-nums text-right",
                      s.count === 0 ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]",
                      // Yellow underline on the stages that actually
                      // project (shows + conversions). Leads + bookings
                      // are unchanged across modes — no marker.
                      isProjected && (s.key === "shows" || s.key === "conversions") &&
                        "underline decoration-[var(--ps-yellow)] decoration-2 underline-offset-[5px]",
                    )}
                    style={{ minWidth: countWidth }}
                  >
                    {fmtCount(s.count)}
                  </div>
                  {s.rate !== null && (
                    <div
                      className={cn(
                        "text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded-md border transition-colors",
                        goalHit === true &&
                          "text-[var(--positive)] border-[var(--positive)]/40 bg-[var(--positive)]/10",
                        goalHit === false &&
                          "text-[var(--negative)] border-[var(--negative)]/40 bg-[var(--negative)]/10",
                        goalHit === null &&
                          "text-[var(--text-secondary)] border-[var(--surface-3)]/60 bg-[var(--surface-2)]",
                      )}
                      title={
                        s.goal !== null
                          ? `Goal: ${formatPercent(s.goal)}`
                          : undefined
                      }
                    >
                      {formatPercent(s.rate)}
                    </div>
                  )}
                  {/* Leads has no conversion rate (it's top-of-funnel) — show
                      its week-over-week change vs the prior period instead, so
                      it carries a trend like the hero/CPL stats. More leads is
                      better, so no color inversion. */}
                  {s.key === "leads" && (
                    <Delta value={leadsDelta} className="text-[11px]" />
                  )}
                </div>
                {isBookings && outstanding > 0 && (
                  <div className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                    {formatNumber(outstanding)} outstanding
                  </div>
                )}
                {isShows && no_shows > 0 && (
                  <div className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                    {fmtCount(no_shows)} no-shows
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
