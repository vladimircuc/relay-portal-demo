"use client";

/**
 * Tiny inline trend chart — no axes, no chrome, just the shape of the data,
 * with a vertical cursor guideline + small highlighted dot on hover and an
 * onHoverChange callback so the parent can swap its own static label/value
 * for the hovered point's values.
 *
 * Why no built-in tooltip:
 *   - The chart is only ~32 px tall, so any floating tooltip pill either
 *     clips against the chart's overflow constraints or overlaps the
 *     dense cell content above (label + big value + delta). Letting the
 *     parent surface the hovered values in its existing static slots
 *     keeps the cell at the same height while making every point on
 *     the curve readable.
 *
 * Edge-case handling: when the input has zero variation (all values the
 * same, or sum is 0), the spark is intentionally suppressed in favor
 * of a quiet baseline rule. A flat line at the bottom of a card looks
 * like a bug; an explicit baseline reads as "no movement during this
 * period."
 */
import { useEffect, useRef, useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  YAxis,
} from "recharts";

export type SparkPoint = {
  /** ISO calendar date string, yyyy-MM-dd. */
  day: string;
  value: number;
};

/**
 * Discriminator for how the parent's tooltip / display should format the
 * value. Sparkline doesn't render anything number-y itself anymore, but
 * the type stays exported so the parent (PerformanceCell) can take the
 * same string and feed it to its own formatter.
 */
export type SparkUnit = "number" | "percent" | "currency";

type Props = {
  data: SparkPoint[];
  color?: string;
  height?: number;
  fill?: boolean;
  /** Notifies the parent when the hovered point changes (or null on leave). */
  onHoverChange?: (point: SparkPoint | null) => void;
};

type Hover = {
  /** Index into `data` of the point closest to the cursor. */
  index: number;
  /** Cursor X within the chart container, in px. Used to position the
   *  vertical guideline + the highlighted dot. */
  xPx: number;
};

export function Sparkline({
  data,
  color = "#ff6a00",
  height = 36,
  fill = true,
  onHoverChange,
}: Props) {
  const values = data.map((p) => p.value);
  const sum = values.reduce((a, b) => a + b, 0);
  const max = values.length ? Math.max(...values) : 0;
  const min = values.length ? Math.min(...values) : 0;
  const hasVariation = values.length >= 2 && max - min > 0;

  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  // Bubble hover changes up to the parent so it can swap its static
  // label/value for the hovered point's numbers.
  useEffect(() => {
    if (!onHoverChange) return;
    onHoverChange(hover ? data[hover.index] : null);
  }, [hover, data, onHoverChange]);

  if (!hasVariation || sum === 0) {
    return (
      <div
        className="w-full flex items-center"
        style={{ height }}
        aria-hidden
      >
        <div className="w-full border-t border-dashed border-[var(--surface-3)]/80" />
      </div>
    );
  }

  const gradId = `spark-${color.replace("#", "")}`;

  // Snap the mouse-x to the nearest data index. Recharts distributes
  // points evenly along the x-axis (we don't use a numeric x accessor),
  // so this linear mapping matches its layout. Snapping ensures the
  // guideline + dot land on a real data point rather than between them.
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || data.length === 0) return;
    const xPx = e.clientX - rect.left;
    const clamped = Math.max(0, Math.min(rect.width, xPx));
    const ratio = data.length === 1 ? 0 : clamped / rect.width;
    const idx = Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1))));
    setHover({
      index: idx,
      xPx: (idx / Math.max(1, data.length - 1)) * rect.width,
    });
  }

  // Project the hovered point's value to a pixel y within the chart so
  // we can draw a small dot on top of the line. Mirrors how recharts'
  // linear y-scale maps values: yRatio in [0,1], then we invert (top=0).
  // The chart has 2px top/bottom margin baked into <ComposedChart>; we
  // honour that so the dot sits visually on the line, not above or
  // below it. The line is a monotone curve so the dot's y is the data
  // point's exact y — between-point interpolation isn't an issue here
  // because we always snap to a real index.
  const usableHeight = Math.max(1, height - 4);
  const hoveredPoint = hover ? data[hover.index] : null;
  const dotY =
    hoveredPoint
      ? 2 + (1 - (hoveredPoint.value - min) / (max - min)) * usableHeight
      : 0;

  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          {fill && (
            <Area
              type="monotone"
              dataKey="value"
              stroke="none"
              fill={`url(#${gradId})`}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {hover && hoveredPoint && (
        // Highlighted dot at the hovered point. Centered on (xPx, dotY)
        // via translate(-50%, -50%) so we don't have to subtract the
        // dot's own size from the coordinates. No vertical guideline —
        // the dot alone is enough to anchor the eye, and the parent
        // cell's value text already swaps to the hovered point.
        <div
          aria-hidden
          className="absolute pointer-events-none rounded-full"
          style={{
            left: hover.xPx,
            top: dotY,
            width: 7,
            height: 7,
            transform: "translate(-50%, -50%)",
            background: color,
            boxShadow: `0 0 0 2px var(--surface-1)`,
          }}
        />
      )}
    </div>
  );
}
