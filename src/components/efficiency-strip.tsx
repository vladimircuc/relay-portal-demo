/**
 * Cost-efficiency strip.
 *
 * Cell anatomy:
 *   label · big value · delta · (optional) emptyHint
 *
 * The strip is always a single full-width row of equal-width cells with a
 * 1px hairline divider between them. Cells stack vertically on mobile.
 *
 * Alignment:
 *   - `align="left"`  — content reads from the left edge.
 *   - `align="center"` (default) — content sits centered in each cell.
 *     Used by the dashboard for the cost-per-stage strip; the 4 cells
 *     are uniform-feeling numeric pills and center-alignment reads more
 *     intentional than left-pinning narrow numbers.
 */
import { cn } from "@/lib/cn";
import { Delta } from "./delta";

export type EfficiencyItem = {
  label: string;
  value: string | null;
  emptyHint?: string;
  delta: number | null;
  invertDelta?: boolean;
  /** When true, render the value with a yellow underline — used by
   *  projected-mode strips for cells whose value actually differs from
   *  real mode (e.g. cost_per_show in projected ≠ in real). */
  projected?: boolean;
};

type Props = {
  title: string;
  items: EfficiencyItem[];
  align?: "left" | "center";
};

export function EfficiencyStrip({ title, items, align = "center" }: Props) {
  return (
    <section className="bg-[var(--surface-3)]/40 rounded-[var(--radius-card)] overflow-hidden border border-[var(--surface-3)]/40">
      {/* Title is hidden on mobile per design — the cells' own labels
          (COST PER LEAD, COST PER BOOKING, …) carry the section
          context, and dropping the header makes the section feel
          tighter on a phone. */}
      <div className="hidden md:block bg-[var(--surface-1)] px-7 pt-6 pb-4 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
        {title}
      </div>
      {/* Mobile: stack vertically (each cell its own row, dividers via
          gap-px on dark bg). md+: single horizontal flex row. */}
      <div className="grid grid-cols-1 gap-px bg-[var(--surface-3)]/40 md:flex">
        {items.map((it, i) => (
          <Cell
            key={it.label}
            item={it}
            isLast={i === items.length - 1}
            align={align}
          />
        ))}
      </div>
    </section>
  );
}

function Cell({
  item,
  isLast,
  align,
}: {
  item: EfficiencyItem;
  isLast: boolean;
  align: "left" | "center";
}) {
  const center = align === "center";
  return (
    <div
      className={cn(
        // Mobile uses smaller padding + min-height; md+ keeps the
        // original generous spacing.
        "relative bg-[var(--surface-1)] px-4 py-5 md:flex-1 md:px-7 md:py-6 flex flex-col gap-3 min-h-[120px] md:min-h-[140px]",
        // 1px hairline divider between cells — only applied in the
        // desktop flex layout; the mobile grid uses gap-px instead.
        !isLast && "md:mr-px",
        center && "items-center",
      )}
    >
      <div className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider">
        {item.label}
      </div>

      {item.value === null ? (
        <div className={cn("flex flex-col gap-1.5 mt-auto", center && "items-center")}>
          <div className="text-[28px] leading-none font-bold tabular-nums text-[var(--text-tertiary)]">
            —
          </div>
          <div className="text-[11px] text-[var(--text-tertiary)] leading-snug">
            {item.emptyHint ?? "Not enough data this period"}
          </div>
        </div>
      ) : (
        <div className={cn("flex flex-col gap-1.5 mt-auto", center && "items-center")}>
          <div
            className={cn(
              "text-[28px] leading-none font-bold tabular-nums tracking-tight text-[var(--text-primary)]",
              item.projected &&
                "underline decoration-[var(--ps-yellow)] decoration-2 underline-offset-[6px]",
            )}
          >
            {item.value}
          </div>
          <Delta value={item.delta} invertColor={item.invertDelta} />
        </div>
      )}
    </div>
  );
}
