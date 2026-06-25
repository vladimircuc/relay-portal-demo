/**
 * Route-level loading UI for the client Socials dashboard.
 *
 * /socials is the heaviest client page: it awaits the stored date bounds,
 * then a 4-way Promise.all (analytics + top content + content library +
 * content mix), each paginating social_daily_metrics / social_posts. Without
 * this file the browser sat on the PREVIOUS page until ALL of that resolved —
 * so clicking "Socials" felt dead (the user's "nothing shows it's loading"
 * complaint). Next renders this skeleton INSTANTLY on navigation and swaps in
 * the real page once page.tsx resolves.
 *
 * Shape mirrors the real dashboard so nothing jumps when data lands:
 *   - DashboardHeader bar (logo + breadcrumb + user-menu placeholders)
 *   - Period-picker strip
 *   - Explorer card: 5 metric tiles + trend chart
 *   - "Top performing content" header + 3 post cards
 */
import { Logo } from "@/components/logo";

function Box({ className = "" }: { className?: string }) {
  return <div className={`ps-skeleton ${className}`} />;
}

export default function SocialsLoading() {
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

      <main className="w-[92vw] lg:w-[75vw] max-w-[1200px] mx-auto py-6 flex flex-col gap-6 md:gap-8">
        {/* Period-picker strip — date-range pill + comparison note + view toggle. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Box className="h-10 w-[260px] rounded-lg" />
            <Box className="h-2.5 w-44 rounded-md opacity-40" />
          </div>
          <Box className="h-9 w-[150px] rounded-lg opacity-60" />
        </div>

        {/* Explorer — 5 metric tiles across the top, trend chart beneath. */}
        <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] overflow-hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px bg-[var(--surface-3)]/40">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-[var(--surface-1)] px-5 py-5 flex flex-col gap-3">
                <Box className="h-2.5 w-20 rounded-md opacity-60" />
                <Box className="h-8 w-24 rounded-md" />
                <Box className="h-2.5 w-12 rounded-md opacity-40" />
              </div>
            ))}
          </div>
          <div className="px-5 sm:px-6 py-6">
            <Box className="h-[280px] w-full rounded-lg opacity-50" />
          </div>
        </div>

        {/* Top performing content — section header + 3 post cards. */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Box className="h-3 w-40 rounded-md opacity-60" />
            <Box className="h-8 w-44 rounded-lg opacity-50" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] overflow-hidden flex flex-col"
              >
                <Box className="aspect-[4/3] w-full rounded-none" />
                <div className="p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Box className="h-6 w-6 rounded-full" />
                    <Box className="h-3 w-24 rounded-md" />
                  </div>
                  <Box className="h-2.5 w-full rounded-md opacity-50" />
                  <Box className="h-2.5 w-2/3 rounded-md opacity-50" />
                  <div className="flex gap-4 mt-1">
                    <Box className="h-7 w-16 rounded-md" />
                    <Box className="h-7 w-16 rounded-md" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
