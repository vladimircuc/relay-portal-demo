"use client";

/**
 * Posting cadence heatmap — a day-of-week × time-of-day grid showing WHEN a
 * client publishes. Each SQUARE cell's yellow intensity scales with how many
 * posts landed in that day/time bucket over the selected range.
 *
 * Pairs with the Content-type donut to its right; together they answer "what
 * gets published, and when." Brand-yellow keeps it sibling to the /ads visuals.
 *
 * Premium touches (the "make it fancy" ask):
 *   - Clean single-hue ramp: filled cells are true brand-yellow at varying
 *     alpha (no muddy olive from mixing into grey), empty cells a faint
 *     neutral. Cells are perfect squares with a hairline inset ring.
 *   - Hover lifts a cell (scale + ring + shadow), reveals its count, and
 *     cross-highlights its row + column headers; the rest of the grid dims so
 *     the focused cell pops.
 *   - A live readout line swaps between the period total (with the busiest
 *     slot called out) and the hovered cell's exact "Day · time · N posts".
 *
 * Presentational only — the server hands it a pre-bucketed matrix. Hover
 * state is local; no data fetching here.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export type PostingCadenceProps = {
  /** matrix[row][col] = post count. row = time bucket, col = day (Mon..Sun). */
  matrix: number[][];
  /** Labels for each time-bucket row, e.g. ["12a","4a","8a","12p","4p","8p"]. */
  rowLabels: string[];
  /** Labels for each day column, e.g. ["Mon",…,"Sun"]. */
  dayLabels: string[];
  /** Optional timezone note shown in the header (e.g. "Chicago time"). */
  tzLabel?: string;
};

type Cell = { r: number; c: number };

export function PostingCadence({ matrix, rowLabels, dayLabels, tzLabel }: PostingCadenceProps) {
  const [hover, setHover] = useState<Cell | null>(null);

  const { total, max, busiest } = useMemo(() => {
    let total = 0;
    let max = 0;
    let busiest: Cell | null = null;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < (matrix[r]?.length ?? 0); c++) {
        const v = matrix[r][c];
        total += v;
        if (v > max) {
          max = v;
          busiest = { r, c };
        }
      }
    }
    return { total, max, busiest };
  }, [matrix]);

  // Single-hue ramp: true brand-yellow at varying alpha over the dark card.
  // Empty cells get a faint neutral so the grid reads even where nothing
  // posted. Mixing yellow into grey (the old approach) muddied to olive — alpha
  // keeps it a clean yellow at every level.
  const fillFor = (v: number) => {
    if (v <= 0) return "var(--heatmap-empty)";
    const t = max > 0 ? v / max : 0;
    const a = 0.16 + t * 0.84; // 0.16 → 1
    return `rgba(255, 106, 0, ${a.toFixed(3)})`;
  };

  const hv = hover ? matrix[hover.r]?.[hover.c] ?? 0 : 0;

  return (
    <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 sm:p-6 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Posting cadence
          </div>
          <p className="text-[12px] text-[var(--text-tertiary)] mt-1">When content goes live</p>
        </div>
        {tzLabel ? (
          <span className="text-[10px] tabular-nums text-[var(--text-tertiary)] mt-0.5 shrink-0">
            {tzLabel}
          </span>
        ) : null}
      </div>

      {total === 0 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
          No content published in this period.
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-4 mt-4">
          {/* Grid: a leading label column for the time rows + one square per day. */}
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `auto repeat(${dayLabels.length}, minmax(0, 1fr))` }}
            onMouseLeave={() => setHover(null)}
          >
            {/* Header row: empty corner + day names. */}
            <div aria-hidden />
            {dayLabels.map((d, c) => (
              <div
                key={`h-${d}`}
                className={cn(
                  "text-center text-[10px] font-medium uppercase tracking-[0.06em] pb-1 transition-colors",
                  hover?.c === c ? "text-[var(--accent-fg)]" : "text-[var(--text-tertiary)]",
                )}
              >
                {d}
              </div>
            ))}

            {/* One labelled row per time bucket. */}
            {rowLabels.map((rl, r) => (
              <Row
                key={`r-${rl}`}
                rowIndex={r}
                rowLabel={rl}
                counts={matrix[r] ?? []}
                hover={hover}
                onHover={setHover}
                fillFor={fillFor}
              />
            ))}
          </div>

          {/* Readout + legend. */}
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12px] text-[var(--text-secondary)] tabular-nums min-h-[18px]">
              {hover ? (
                <>
                  <span className="font-semibold text-[var(--text-primary)]">{dayLabels[hover.c]}</span>{" "}
                  {rowLabels[hover.r]} ·{" "}
                  <span className="font-semibold text-[var(--text-primary)]">{hv}</span>{" "}
                  {hv === 1 ? "post" : "posts"}
                </>
              ) : (
                <>
                  <span className="font-semibold text-[var(--text-primary)]">{total}</span>{" "}
                  {total === 1 ? "post" : "posts"}
                  {busiest && max > 0 ? (
                    <>
                      {" "}· busiest{" "}
                      <span className="font-semibold text-[var(--text-primary)]">
                        {dayLabels[busiest.c]} {rowLabels[busiest.r]}
                      </span>
                    </>
                  ) : null}
                </>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-[var(--text-tertiary)]">Less</span>
              <div className="flex items-center gap-1">
                {[0.16, 0.44, 0.72, 1].map((a) => (
                  <span
                    key={a}
                    className="h-2.5 w-2.5 rounded-[3px]"
                    style={{ background: `rgba(255, 106, 0, ${a})` }}
                  />
                ))}
              </div>
              <span className="text-[10px] text-[var(--text-tertiary)]">More</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  rowIndex,
  rowLabel,
  counts,
  hover,
  onHover,
  fillFor,
}: {
  rowIndex: number;
  rowLabel: string;
  counts: number[];
  hover: Cell | null;
  onHover: (c: Cell | null) => void;
  fillFor: (v: number) => string;
}) {
  return (
    <>
      <div
        className={cn(
          "flex items-center justify-end pr-1.5 text-[10px] tabular-nums transition-colors",
          hover?.r === rowIndex ? "text-[var(--accent-fg)]" : "text-[var(--text-tertiary)]",
        )}
      >
        {rowLabel}
      </div>
      {counts.map((v, c) => {
        const isHover = hover?.r === rowIndex && hover?.c === c;
        const dim = hover !== null && !isHover;
        return (
          <div
            key={c}
            onMouseEnter={() => onHover({ r: rowIndex, c })}
            onMouseLeave={() => onHover(null)}
            className={cn(
              "relative aspect-square rounded-lg cursor-default transition-all duration-150",
              isHover
                ? "scale-110 z-10 ring-2 ring-[var(--ps-yellow)] shadow-[0_6px_18px_rgba(0,0,0,0.5)]"
                : "ring-1 ring-inset ring-white/[0.06]",
              dim ? "opacity-55" : "opacity-100",
            )}
            style={{ background: fillFor(v) }}
          >
            {isHover && v > 0 ? (
              <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold tabular-nums text-black/80">
                {v}
              </span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
