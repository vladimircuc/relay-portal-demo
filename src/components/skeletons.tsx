/**
 * Per-section skeleton components, each matching the layout/dimensions of the
 * real component it stands in for. Used as Suspense fallbacks so each section
 * can stream in independently while the others render their real content.
 *
 * Skeletons use the `ps-skeleton` class (defined in globals.css) which paints
 * a slow brand-tinted shimmer sweep — feels more like content streaming in
 * than the default `animate-pulse` opacity flicker.
 */

function Box({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`ps-skeleton rounded-md ${className}`}
      style={style}
    />
  );
}

function Card({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] ${className}`}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero stats (one card, three cells with an arrow + equals between)

export function HeroStatsSkeleton() {
  return (
    <Card className="px-6 py-7 md:px-10 md:py-9">
      <div className="flex flex-col gap-6 md:grid md:grid-cols-3 md:gap-8 md:items-center">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-4">
            <Box className="h-3 w-28 opacity-60" />
            <Box className="h-10 md:h-12 w-44" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Source breakdown (donut + ranked list)

export function SourceBreakdownSkeleton() {
  return (
    <Card className="p-7">
      <div className="flex items-center justify-between mb-6">
        <Box className="h-3 w-32 opacity-60" />
        <Box className="h-7 w-32" />
      </div>
      <div className="flex flex-col gap-6 md:grid md:grid-cols-[1fr_1.4fr] md:gap-10 md:items-center">
        {/* Donut placeholder — pulsing ring */}
        <div className="mx-auto relative" style={{ width: 280, height: 280 }}>
          <div className="ps-skeleton absolute inset-0 rounded-full" />
          <div className="absolute inset-[60px] rounded-full bg-[var(--surface-1)]" />
        </div>
        <ul className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i} className="grid grid-cols-[10px_1fr_auto_auto] items-center gap-3">
              <Box className="h-2.5 w-2.5 rounded-full" />
              <Box className="h-4" />
              <Box className="h-4 w-10" />
              <Box className="h-3 w-10 opacity-60" />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline funnel (4 narrowing trapezoid blocks + side info)

export function FunnelSkeleton() {
  return (
    <Card className="p-7">
      <Box className="h-3 w-32 opacity-60 mb-6" />
      <div className="grid grid-cols-[260px_minmax(140px,160px)] gap-8 items-center">
        <div className="flex flex-col items-center gap-3">
          {[100, 75, 50, 30].map((w, i) => (
            <Box key={i} className="h-14" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5" style={{ height: 56 }}>
              <Box className="h-2 w-16 opacity-60" />
              <Box className="h-7 w-20" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost-efficiency strip skeleton. Always renders the Cost strip; optionally
// stacks a parallel Revenue strip beneath it when the viewer is on Advanced
// tier (so the layout doesn't pop when the real data arrives).

function StripSkeleton({ cells }: { cells: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-7 pt-6 pb-4">
        <Box className="h-3 w-28 opacity-60" />
      </div>
      <div className="flex bg-[var(--surface-3)]/40">
        {Array.from({ length: cells }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-[var(--surface-1)] px-7 py-6 flex flex-col items-center gap-3 min-h-[140px]"
            style={i < cells - 1 ? { marginRight: 1 } : undefined}
          >
            <Box className="h-2 w-24 opacity-60" />
            <div className="flex flex-col items-center gap-1.5 mt-auto">
              <Box className="h-8 w-28" />
              <Box className="h-3 w-12 opacity-50" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function EfficiencyStripSkeleton({
  cells = 4,
  withRevenueStrip = false,
}: {
  cells?: number;
  /** Show the second Revenue Efficiency strip below (Advanced tier). */
  withRevenueStrip?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <StripSkeleton cells={cells} />
      {withRevenueStrip && (
        <div className="hidden md:block">
          <StripSkeleton cells={cells} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ad-performance row (CTR/CPC/CPM with sparklines)

export function PerformanceRowSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="px-7 pt-6 pb-4">
        <Box className="h-3 w-24 opacity-60" />
      </div>
      <div className="flex bg-[var(--surface-3)]/40">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex-1 bg-[var(--surface-1)] px-7 pt-4 pb-5 flex flex-col gap-3"
            style={i < 2 ? { marginRight: 1 } : undefined}
          >
            <Box className="h-2 w-12 opacity-60" />
            <Box className="h-7 w-24" />
            <Box className="h-8 opacity-40" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Projected card (4 cells in a strip)

export function ProjectedCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="px-7 pt-6 pb-4 flex items-center justify-between gap-3 flex-wrap">
        <Box className="h-3 w-24 opacity-60" />
        <div className="flex items-center gap-3 flex-wrap">
          <Box className="h-2 w-44 opacity-40" />
          {/* Segmented-toggle placeholder — matches the 3-option toggle
              rendered by the real component (6 / 9 / 12 months). */}
          <Box className="h-7 w-48 rounded-lg opacity-50" />
        </div>
      </div>
      <div className="flex bg-[var(--surface-3)]/40">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            // Matches the real card's tightened layout (no min-h, no
            // mt-auto on the value). Otherwise the skeleton would be
            // taller than the real thing and pop down on resolve.
            className="flex-1 bg-[var(--surface-1)] px-7 py-5 flex flex-col items-center gap-2.5"
            style={i < 3 ? { marginRight: 1 } : undefined}
          >
            <Box className="h-2 w-16 opacity-60" />
            <Box className="h-8 w-28" />
          </div>
        ))}
      </div>
    </Card>
  );
}
