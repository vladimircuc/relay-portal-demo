"use client";

/**
 * Wraps any displayed value that varies between Real and Projected modes.
 *
 * Reads useViewMode() and:
 *   - In `real` mode: renders `realChildren` (the actual number).
 *   - In `projected` mode: renders `projectedChildren` (the projected
 *     value) wrapped with a yellow underline + small "ⓟ" superscript
 *     so the screenshot is unambiguously labelled.
 *
 * Use this for any metric that ACTUALLY changes between modes (revenue,
 * ROAS, projected shows, etc.). For metrics that don't change (spend,
 * leads, bookings, CPL), render them normally without this wrapper —
 * the differentiator should only highlight what's actually projected.
 */
import { useViewMode } from "./view-mode-context";

type Props = {
  /** What to render in real mode. */
  realChildren: React.ReactNode;
  /** What to render in projected mode — gets the visual decoration. */
  projectedChildren: React.ReactNode;
  /** Optional className applied to the wrapper span in both modes. */
  className?: string;
};

export function ProjectedValue({ realChildren, projectedChildren, className }: Props) {
  const { viewMode } = useViewMode();
  if (viewMode === "real") {
    return <span className={className}>{realChildren}</span>;
  }
  return (
    <span
      className={
        // Yellow underline: 2px solid, brand yellow, slightly offset
        // so descenders don't crash into it. `decoration-skip-ink:none`
        // would crash currency glyphs into the line — let the browser
        // skip the glyph descenders by default.
        "decoration-[var(--ps-yellow)] decoration-2 underline underline-offset-[5px] " +
        (className ?? "")
      }
      title="Projected"
    >
      {projectedChildren}
    </span>
  );
}
