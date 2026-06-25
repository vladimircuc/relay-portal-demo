"use client";

/**
 * Content type breakdown — a donut + ranked legend showing how a client's
 * published content splits across media types (Reels, Videos, Photos,
 * Carousels, Text) over the selected range.
 *
 * Deliberately mirrors the /ads Source-breakdown donut: same yellow-led
 * palette, same hover-to-focus interaction (hovering a slice or a legend row
 * dims the others and swaps the donut centre to that slice's count + share),
 * so the Ads and Socials modules read as one product.
 *
 * Presentational only — the server hands it pre-aggregated counts; hover state
 * is local. No data fetching here.
 */
import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Film, Clapperboard, Image as ImageIcon, Images, FileText, type LucideIcon } from "lucide-react";
import type { ContentMediaType } from "@/components/top-content";
import { cn } from "@/lib/cn";
import { useChartColors } from "@/components/use-chart-colors";

const MEDIA: Record<ContentMediaType, { icon: LucideIcon; label: string }> = {
  reel:     { icon: Clapperboard, label: "Reels" },
  video:    { icon: Film,         label: "Videos" },
  image:    { icon: ImageIcon,    label: "Photos" },
  carousel: { icon: Images,       label: "Carousels" },
  text:     { icon: FileText,     label: "Text" },
};

export type ContentTypeSlice = { type: ContentMediaType; count: number };

export function ContentTypeBreakdown({ slices }: { slices: ContentTypeSlice[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Theme-aware ramp — same source as the /ads Source breakdown so the donuts
  // stay siblings in both light + dark.
  const { ramp } = useChartColors();
  const colorFor = (i: number) => ramp[i] ?? ramp[ramp.length - 1];

  // Sort desc so the biggest type gets the brand-yellow slice and leads the list.
  const data = [...slices].filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
  const total = data.reduce((s, d) => s + d.count, 0);

  const hovered = hover !== null ? data[hover] : null;
  const fmtPct = (c: number) => {
    const p = total > 0 ? (c / total) * 100 : 0;
    return p >= 10 || p === 0 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
  };

  return (
    <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 sm:p-6 flex flex-col">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
        Content type
      </div>
      <p className="text-[12px] text-[var(--text-tertiary)] mt-1 mb-4">What gets published</p>

      {total === 0 ? (
        <div className="flex-1 min-h-[220px] flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
          No content published in this period.
        </div>
      ) : (
        <div
          className="flex flex-1 flex-col justify-center gap-6 md:grid md:grid-cols-[1.05fr_1fr] md:gap-8 md:items-center"
          onMouseLeave={() => setHover(null)}
        >
          {/* Donut + centre label — desktop only (no graphs on mobile; the
              ranked legend below carries the per-type counts). */}
          <div className="relative mx-auto w-full max-w-[280px] aspect-square hidden md:block">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.map((d, i) => ({ name: MEDIA[d.type].label, value: d.count, color: colorFor(i) }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="62%"
                  outerRadius="96%"
                  paddingAngle={2}
                  stroke="var(--surface-1)"
                  strokeWidth={3}
                  isAnimationActive={false}
                  onMouseEnter={(_, idx) => setHover(idx)}
                  onMouseLeave={() => setHover(null)}
                >
                  {data.map((_, i) => (
                    <Cell
                      key={i}
                      fill={colorFor(i)}
                      fillOpacity={hover === null || hover === i ? 1 : 0.32}
                      style={{ cursor: "pointer", transition: "fill-opacity 150ms ease" }}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>

            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
              <div className="text-[34px] font-bold tabular-nums leading-none text-[var(--text-primary)]">
                {hovered ? hovered.count : total}
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] mt-1.5">
                {hovered ? `${fmtPct(hovered.count)} of posts` : "Posts"}
              </div>
            </div>
          </div>

          {/* Ranked legend — to the RIGHT of the donut on md+, stacked below on mobile. */}
          <ul
            className="flex flex-col divide-y divide-[var(--surface-3)]/40"
            onMouseLeave={() => setHover(null)}
          >
            {data.map((d, i) => {
              const m = MEDIA[d.type];
              const dim = hover !== null && hover !== i;
              return (
                <li
                  key={d.type}
                  onMouseEnter={() => setHover(i)}
                  className={cn(
                    "grid grid-cols-[14px_1fr_auto_auto] items-center gap-2.5 py-2 px-2 -mx-2 rounded-md cursor-default transition-colors",
                    hover === i ? "bg-[var(--surface-2)]" : "",
                  )}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full transition-opacity"
                    style={{ background: colorFor(i), opacity: dim ? 0.4 : 1 }}
                  />
                  <span className={cn(
                    "inline-flex items-center gap-1.5 text-[13px] truncate transition-colors",
                    dim ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]",
                  )}>
                    <m.icon size={13} strokeWidth={2.25} /> {m.label}
                  </span>
                  <span className={cn(
                    "text-[13px] font-semibold tabular-nums transition-colors",
                    dim ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]",
                  )}>
                    {d.count}
                  </span>
                  <span className="text-[11px] tabular-nums text-[var(--text-tertiary)] w-10 text-right">
                    {fmtPct(d.count)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
