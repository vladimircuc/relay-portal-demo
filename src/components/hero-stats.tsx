"use client";

/**
 * Hero stats — an equation-style row:  Spend → Revenue = ROAS
 *
 * Takes both `real` and `projected` triples; the viewMode context
 * picks which one displays. Spend is always the same across modes
 * (we already spent the money, no projection there), so it never
 * gets the yellow projected-value underline. Revenue and ROAS DO
 * project, and their cells switch to the projected values + get a
 * yellow underline when viewMode === 'projected'.
 *
 * Deltas (vs the previous period) show in BOTH modes. In projected
 * mode the projected value is treated like any actual: its delta is
 * pctChange(projected, prior period) — the same prior-period baseline
 * the real deltas use. Spend doesn't project, so its delta is identical
 * across modes.
 *
 * Layout / typography unchanged from the server-only version that
 * preceded this: 5-col grid with → and = operators on desktop,
 * stacked cells on mobile.
 */
import { Delta } from "./delta";
import { TickingNumber, type TickFormat } from "./ticking-number";
import { useViewMode } from "./view-mode-context";

type Triple = {
  spend: number;
  revenue: number;
  roas: number | null;
};

type Props = {
  real: Triple;
  /** Same shape; spend is identical to real.spend by construction. */
  projected: Triple;
  /** False when the rate sample window had no conversions / shows /
   *  bookings to compute rates from. In that case `projected` will
   *  equal `real` and we should NOT decorate values as projected. */
  canProject: boolean;
  /** Period-over-period deltas (real values vs prior period). */
  spendDelta: number | null;
  revenueDelta: number | null;
  roasDelta: number | null;
  /** Projected-mode deltas — projected value vs the same prior period.
   *  Spend doesn't project, so it reuses spendDelta in both modes. */
  projectedRevenueDelta: number | null;
  projectedRoasDelta: number | null;
};

export function HeroStats({
  real,
  projected,
  canProject,
  spendDelta,
  revenueDelta,
  roasDelta,
  projectedRevenueDelta,
  projectedRoasDelta,
}: Props) {
  const { viewMode } = useViewMode();
  // "Projected display" only really applies when both the toggle is on
  // AND we actually have a projection. With insufficient sample data
  // we silently fall back to real so the banner can explain it once
  // without the rest of the dashboard going visually weird.
  const isProjected = viewMode === "projected" && canProject;
  const view = isProjected ? projected : real;

  // Deltas show in both modes. In projected mode the projected figure is
  // treated like an actual — its delta uses the same prior-period baseline.
  // Spend never projects, so its delta is identical across modes.
  const revDelta = isProjected ? projectedRevenueDelta : revenueDelta;
  const roasDeltaShown = isProjected ? projectedRoasDelta : roasDelta;

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] px-6 py-8 md:px-10 md:py-9">
      <div className="flex flex-col gap-8 md:grid md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center md:gap-8">
        {/* Spend — unchanged between modes. */}
        <HeroCell
          label="Total spend"
          value={view.spend}
          format="currency"
          delta={spendDelta}
        />
        <Operator desktopGlyph="→" mobileGlyph="↓" />

        {/* Revenue — projects in projected mode. */}
        <HeroCell
          label="Revenue generated"
          value={view.revenue}
          format="currency"
          delta={revDelta}
          projected={isProjected}
        />
        <Operator desktopGlyph="=" mobileGlyph="=" />

        {/* ROAS — projects in projected mode (revenue / spend with
            projected revenue, since spend is constant). */}
        <HeroCell
          label="Return on ad spend"
          value={view.roas}
          format="multiplier"
          delta={roasDeltaShown}
          highlight
          projected={isProjected}
        />
      </div>
    </section>
  );
}

function HeroCell({
  label,
  value,
  format,
  delta,
  invertDelta,
  highlight,
  projected,
}: {
  label: string;
  value: number | null;
  format: TickFormat;
  delta?: number | null;
  invertDelta?: boolean;
  highlight?: boolean;
  /** When true, render the value with the projected-value underline. */
  projected?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          {label}
        </span>
        {delta !== undefined && <Delta value={delta} invertColor={invertDelta} />}
      </div>
      <TickingNumber
        value={value}
        format={format}
        className={
          "text-[40px] md:text-[56px] leading-none font-bold tabular-nums tracking-tight " +
          (highlight ? "text-[var(--accent-strong)]" : "text-[var(--text-primary)]") +
          // Yellow underline anchored to the rendered number. We use
          // text-decoration directly (not the ProjectedValue wrapper)
          // because TickingNumber renders its own <span> and we want
          // the underline on the same element as the text — otherwise
          // the underline can sit too far from descenders.
          (projected
            ? " underline decoration-[var(--ps-yellow)] decoration-2 underline-offset-[6px]"
            : "")
        }
      />
    </div>
  );
}

/**
 * Renders the visual operator between Hero cells:
 *   - Horizontal layout (desktop): big glyph between columns. The
 *     `desktopGlyph` is typically `→` or `=`.
 *   - Vertical layout (mobile): glyph between stacked cells. The
 *     `mobileGlyph` is typically `↓` or `=` — a sideways arrow makes
 *     no sense when the cells flow top-to-bottom.
 *
 * Two separate render paths instead of a single conditional className
 * because the desktop and mobile glyphs need different font sizes +
 * vertical nudges (the desktop variant has an optical-center offset
 * that doesn't belong on mobile).
 */
function Operator({
  desktopGlyph,
  mobileGlyph,
}: {
  desktopGlyph: string;
  mobileGlyph: string;
}) {
  return (
    <>
      {/* Mobile — sits in the column between stacked cells. */}
      <div
        aria-hidden
        className="md:hidden text-[28px] leading-none font-light text-[var(--text-tertiary)] select-none text-center"
      >
        {mobileGlyph}
      </div>
      {/* Desktop — sits in the row between cells. */}
      <div
        aria-hidden
        className="hidden md:block text-[38px] leading-none font-light text-[var(--text-tertiary)] select-none px-1 md:px-2"
        style={{ marginTop: 22 /* optically center with numbers, not labels */ }}
      >
        {desktopGlyph}
      </div>
    </>
  );
}
