/**
 * Subtle inline delta indicator. Replaces the loud chip-style badges with
 * a quieter arrow + percentage that sits next to numbers without competing
 * for attention.
 */
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/formatters";

type Props = {
  value: number | null | undefined;
  /** If true, a negative change is the desired outcome (CPL going down, etc.) */
  invertColor?: boolean;
  className?: string;
};

// Anything below this threshold rounds to "0.0%" at our 1-decimal display
// precision, so we render it as a neutral zero (grey, no arrow) instead of
// a coloured "↑ 0.0%" / "↓ 0.0%" that misrepresents a non-change.
const ZERO_EPSILON = 0.0005;

export function Delta({ value, invertColor, className }: Props) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("text-xs text-[var(--text-tertiary)]", className)}>—</span>;
  }
  if (Math.abs(value) < ZERO_EPSILON) {
    return <span className={cn("text-xs text-[var(--text-tertiary)]", className)}>0%</span>;
  }
  const arrow = value > 0 ? "↑" : "↓";
  const isGood = invertColor ? value < 0 : value > 0;
  return (
    <span
      className={cn(
        "text-xs font-medium tabular-nums",
        isGood ? "text-[color-mix(in_oklab,var(--positive)_85%,white)]" : "text-[color-mix(in_oklab,var(--negative)_85%,white)]",
        className,
      )}
    >
      {arrow} {formatPercent(Math.abs(value))}
    </span>
  );
}
