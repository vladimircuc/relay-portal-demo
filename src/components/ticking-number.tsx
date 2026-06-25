"use client";

/**
 * Animates a number from its previous render value to the new value over a
 * short duration with ease-out. Use it for the hero/big-number positions
 * where you want a satisfying "count up" when the period changes.
 *
 * The format is identified by a string key (not a function) so this component
 * can be passed plain props from a Server Component without tripping React's
 * "Functions cannot be passed to Client Components" guard. Display matches
 * what the corresponding `formatCurrency` / `formatMultiplier` would produce.
 *
 * Implementation notes:
 *   - First mount renders immediately at the target value (no animation
 *     from 0) so initial page load doesn't flash a 0 → real animation.
 *   - Subsequent value changes interpolate over `durationMs` using
 *     requestAnimationFrame and a cubic ease-out.
 *   - Skipped entirely when `prefers-reduced-motion` is set.
 *   - If `value` is null, just renders the formatted null state (usually "—").
 */
import { useEffect, useRef, useState } from "react";
import { formatCurrency, formatMultiplier, formatNumber, formatPercent } from "@/lib/formatters";

export type TickFormat = "currency" | "currency2" | "multiplier" | "number" | "percent";

function applyFormat(spec: TickFormat, n: number | null): string {
  switch (spec) {
    case "currency":   return formatCurrency(n);
    case "currency2":  return formatCurrency(n, 2);
    case "multiplier": return formatMultiplier(n);
    case "number":     return formatNumber(n);
    case "percent":    return formatPercent(n);
  }
}

type Props = {
  value: number | null;
  format: TickFormat;
  /** Animation duration in ms. Defaults to 600. */
  durationMs?: number;
  className?: string;
};

// Cubic ease-out — fast start, gentle settle. Feels natural for counters.
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function TickingNumber({ value, format, durationMs = 600, className }: Props) {
  // The number currently being displayed (interpolated frame value).
  const [display, setDisplay] = useState<number | null>(value);
  // Previous target — what we're animating FROM on the next change.
  const previousRef = useRef<number | null>(value);
  // RAF handle so we can cancel on rapid changes.
  const rafRef = useRef<number | null>(null);
  // Skip animating on the very first render.
  const firstRenderRef = useRef(true);

  useEffect(() => {
    // First effect run: just lock in the initial value, no animation.
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      previousRef.current = value;
      setDisplay(value);
      return;
    }

    // Null → just snap (no meaningful interpolation between null states).
    if (value === null || previousRef.current === null) {
      previousRef.current = value;
      setDisplay(value);
      return;
    }

    // Respect reduced-motion preference.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      previousRef.current = value;
      setDisplay(value);
      return;
    }

    const start = previousRef.current;
    const end = value;
    // Nothing to animate.
    if (start === end) return;

    const startTime = performance.now();

    function step(now: number) {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = easeOutCubic(t);
      const v = (start as number) + ((end as number) - (start as number)) * eased;
      setDisplay(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        previousRef.current = end;
        rafRef.current = null;
      }
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, durationMs]);

  return <span className={className}>{applyFormat(format, display)}</span>;
}
