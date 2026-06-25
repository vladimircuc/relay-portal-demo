/**
 * Route-level loading UI for the client SEO dashboard.
 *
 * /seo awaits stored date bounds, then loadSeoData (GSC search totals + 28-day
 * and 365-day series + top queries/pages, GA4 channels/landing, Bing AI
 * citations) — several Postgres round-trips. Without this file the browser sat
 * on the PREVIOUS page until all of it resolved, and the bare-slug fallback
 * skeleton (a different width + shape) caused a layout jump when the real page
 * landed. Next renders this skeleton INSTANTLY on navigation; its shape mirrors
 * the real dashboard (header → period strip → search tiles + trend → two tables
 * → website analytics → AI performance → 12-month trend) so nothing shifts when
 * data arrives.
 */
import { Logo } from "@/components/logo";

function Box({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`ps-skeleton ${className}`} style={style} />;
}

function StatTiles({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-4 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <Box className="h-2.5 w-16 rounded-md opacity-60" />
            <Box className="h-7 w-7 rounded-lg opacity-50" />
          </div>
          <Box className="h-6 w-20 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function ChartCard({ height = 268 }: { height?: number }) {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5">
      <Box className="h-4 w-40 rounded-md mb-4 opacity-70" />
      <Box className="w-full rounded-lg opacity-50" style={{ height }} />
    </div>
  );
}

function TableCard() {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Box className="h-7 w-7 rounded-lg opacity-50" />
          <Box className="h-4 w-44 rounded-md opacity-70" />
        </div>
        <Box className="h-3 w-28 rounded-md opacity-40" />
      </div>
      {/* Match the real SearchTable scroll area (max-h-[604px], ~45px rows): a
          header strip + 13 rows ≈ 600px, so the page below doesn't jump up when
          the rows land. */}
      <div className="rounded-lg border border-[var(--surface-3)]/30 overflow-hidden">
        <Box className="h-10 w-full rounded-none opacity-40" />
        {Array.from({ length: 13 }).map((_, i) => (
          <Box key={i} className="h-[44px] w-full rounded-none" style={{ opacity: Math.max(0.1, 0.55 - i * 0.04) }} />
        ))}
      </div>
    </div>
  );
}

function RankedCard() {
  return (
    <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Box className="h-7 w-7 rounded-lg opacity-50" />
        <Box className="h-4 w-40 rounded-md opacity-70" />
      </div>
      {/* ~10 rows at the real py-2 rhythm so the card settles near the real
          max-h-[420px] list height (no jump in the AI / landing-page rows). */}
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5" style={{ opacity: Math.max(0.15, 1 - i * 0.08) }}>
            <div className="flex items-center justify-between">
              <Box className="h-3 w-40 rounded-md opacity-60" />
              <Box className="h-3 w-10 rounded-md opacity-60" />
            </div>
            <Box className="h-1 w-full rounded-full opacity-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionHeading() {
  return (
    <div className="flex items-center gap-2.5">
      <Box className="h-5 w-44 rounded-md" />
      <Box className="h-3 w-32 rounded-md opacity-40" />
    </div>
  );
}

export default function SeoLoading() {
  return (
    <>
      {/* Header skeleton — matches DashboardHeader dimensions exactly so the
          chrome doesn't shift when the real header renders. */}
      <header className="border-b border-[var(--surface-3)]/60 bg-[var(--surface-0)]/95 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-6 lg:px-12 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Logo size={28} />
            <Box className="h-5 w-32 rounded-md" />
          </div>
          <div className="flex items-center gap-5">
            <Box className="h-8 w-36 rounded-md opacity-60 hidden md:block" />
            <Box className="h-8 w-8 rounded-full" />
          </div>
        </div>
      </header>

      <main className="w-[92vw] lg:w-[78vw] max-w-[1280px] mx-auto py-6 flex flex-col gap-6 md:gap-8">
        {/* Period strip — label + date-range pill. */}
        <div className="flex flex-col gap-2">
          <Box className="h-2.5 w-14 rounded-md opacity-50" />
          <Box className="h-11 w-[280px] max-w-full rounded-lg" />
          <Box className="h-2.5 w-44 rounded-md opacity-40" />
        </div>

        {/* Search performance — 5 tiles + trend chart. */}
        <div className="flex flex-col gap-4">
          <SectionHeading />
          <StatTiles count={5} />
          <ChartCard height={268} />
        </div>

        {/* Keyword + page tables. */}
        <TableCard />
        <TableCard />

        {/* Website analytics — 4 tiles + donut / landing pages row. */}
        <div className="flex flex-col gap-4">
          <SectionHeading />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-4 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <Box className="h-2.5 w-16 rounded-md opacity-60" />
                  <Box className="h-7 w-7 rounded-lg opacity-50" />
                </div>
                <Box className="h-6 w-20 rounded-md" />
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 sm:p-6 flex flex-col">
              <Box className="h-4 w-32 rounded-md mb-1.5 opacity-70" />
              <Box className="h-2.5 w-44 rounded-md mb-5 opacity-40" />
              {/* disc ~ the real clamped 248 max; 6 legend rows at the real divide-y rhythm */}
              <div className="flex flex-col md:grid md:grid-cols-[1.05fr_1fr] md:items-center gap-7">
                <div className="mx-auto"><Box className="h-[232px] w-[232px] rounded-full" /></div>
                <div className="flex flex-col gap-3.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Box key={i} className="h-4 w-full rounded-md" style={{ opacity: Math.max(0.25, 1 - i * 0.12) }} />
                  ))}
                </div>
              </div>
            </div>
            <RankedCard />
          </div>
        </div>

        {/* AI Performance — 2 feature cards + chart, then two ranked lists. */}
        <div className="flex flex-col gap-4">
          <SectionHeading />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
            <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
              <Box className="h-[156px] w-full rounded-[var(--radius-card)] opacity-60" />
              <Box className="h-[156px] w-full rounded-[var(--radius-card)] opacity-60" />
            </div>
            <ChartCard height={196} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <RankedCard />
            <RankedCard />
          </div>
        </div>

        {/* 12-month trend — 5 tiles + chart. */}
        <div className="flex flex-col gap-4">
          <SectionHeading />
          <StatTiles count={5} />
          <ChartCard height={280} />
        </div>
      </main>
    </>
  );
}
