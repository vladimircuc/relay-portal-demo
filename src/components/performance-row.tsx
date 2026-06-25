"use client";

/**
 * Advanced-tier performance row: CTR / CPC / CPM with daily sparklines.
 *
 * Each cell is a stateful client component (PerformanceCell). On hover
 * over the sparkline, the cell's static label gets a date suffix and
 * the big value swaps to show the hovered point's value — same pattern
 * Robinhood / Apple Health use. No floating tooltip pill to overlap
 * other content; the cell at-rest height stays constant.
 *
 * `unit` is a string discriminator (not a formatter function) so the
 * row can be rendered from a Server Component without crossing a
 * server→client boundary with a function.
 */
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { Delta } from "./delta";
import { Sparkline, type SparkPoint, type SparkUnit } from "./sparkline";

type Item = {
  label: string;
  value: string;
  delta: number | null;
  invertDelta?: boolean;
  series: SparkPoint[];
  unit: SparkUnit;
};

function formatByUnit(v: number, unit: SparkUnit): string {
  switch (unit) {
    case "percent":  return formatPercent(v, 2);
    case "currency": return formatCurrency(v, 2);
    case "number":
    default:         return v.toFixed(2);
  }
}

/** yyyy-MM-dd → "Mar 14". Local midnight to avoid TZ drift. */
function formatDay(day: string): string {
  return new Date(day + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function PerformanceRow({ items }: { items: Item[] }) {
  return (
    <section className="bg-[var(--surface-3)]/40 rounded-[var(--radius-card)] border border-[var(--surface-3)]/40">
      <div className="bg-[var(--surface-1)] rounded-t-[var(--radius-card)] px-7 pt-6 pb-4 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
        Ad Performance
      </div>
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((it, i) => (
          <PerformanceCell
            key={it.label}
            item={it}
            isFirst={i === 0}
            isLast={i === items.length - 1}
          />
        ))}
      </div>
    </section>
  );
}

function PerformanceCell({
  item,
  isFirst,
  isLast,
}: {
  item: Item;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState<SparkPoint | null>(null);

  // When hovered, the cell shows the hovered point's date + value
  // instead of the period summary. When not, it shows the static
  // period summary + delta as usual.
  const showHover = hovered !== null;
  const displayValue = showHover
    ? formatByUnit(hovered.value, item.unit)
    : item.value;

  return (
    <div
      className={cn(
        "bg-[var(--surface-1)] px-7 py-5 flex flex-col gap-3",
        // Round the corners that touch the section's rounded corners.
        isFirst && "rounded-bl-[var(--radius-card)]",
        isLast && "rounded-br-[var(--radius-card)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider flex items-baseline gap-2 min-w-0">
          <span className="truncate">{item.label}</span>
          {showHover && (
            <span className="text-[var(--text-secondary)] normal-case tracking-normal text-[11px] tabular-nums whitespace-nowrap">
              · {formatDay(hovered.day)}
            </span>
          )}
        </div>
        {/* Delta hides on hover — the hovered single-day value isn't a
            period delta, so showing the static delta next to a point
            value would be misleading. Static delta returns on mouse-out. */}
        {!showHover && (
          <Delta value={item.delta} invertColor={item.invertDelta} />
        )}
      </div>
      <div className="text-[26px] leading-none font-bold tabular-nums tracking-tight text-[var(--text-primary)]">
        {displayValue}
      </div>
      {/* Sparkline height bumped from 32 → 56 — gives the curve more
          vertical room so peaks and valleys read as actual movement
          rather than noise. Still compact enough that the cell stays
          shorter than the Hero card above it. */}
      <div className="opacity-90 mt-1">
        <Sparkline
          data={item.series}
          color="#ff6a00"
          height={56}
          onHoverChange={setHovered}
        />
      </div>
    </div>
  );
}
