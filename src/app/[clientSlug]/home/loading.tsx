/**
 * Route-level loading UI for the client Home tab.
 *
 * Home does no data fetching, but it still runs auth + access resolution
 * (getCurrentUser → resolveAccess → readRecentClientSlugs) on the server
 * before its first byte. Without this file the browser sat on the previous
 * page during that round-trip with no feedback. Next renders this skeleton
 * instantly and swaps in <HomeOverview> when page.tsx resolves.
 *
 * Shape mirrors <HomeOverview>: header bar + hero block + product-card grid.
 */
import { Logo } from "@/components/logo";

function Box({ className = "" }: { className?: string }) {
  return <div className={`ps-skeleton ${className}`} />;
}

export default function HomeLoading() {
  return (
    <>
      <header className="border-b border-[var(--surface-3)]/60 bg-[var(--surface-0)]/95 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-6 lg:px-12 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Logo size={28} />
            <Box className="h-5 w-32 rounded-md" />
          </div>
          <div className="flex items-center gap-5">
            <Box className="h-8 w-8 rounded-full" />
          </div>
        </div>
      </header>

      <main className="w-[92vw] lg:w-[75vw] max-w-[1100px] mx-auto py-8 md:py-12 flex flex-col gap-8 md:gap-10">
        {/* Hero — eyebrow pill, headline, intro paragraph. */}
        <section className="flex flex-col gap-3">
          <Box className="h-6 w-28 rounded-full opacity-60" />
          <Box className="h-9 w-72 max-w-full rounded-lg" />
          <Box className="h-4 w-full max-w-2xl rounded-md opacity-50" />
          <Box className="h-4 w-80 max-w-full rounded-md opacity-50" />
        </section>

        {/* Product cards — "what you can see" grid (1–2 columns). */}
        <section className="flex flex-col gap-4">
          <Box className="h-3 w-32 rounded-md opacity-50" />
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-6 flex flex-col gap-3"
              >
                <div className="flex items-center gap-3">
                  <Box className="h-11 w-11 rounded-xl" />
                  <Box className="h-5 w-28 rounded-md" />
                </div>
                <Box className="h-3 w-full rounded-md opacity-50" />
                <Box className="h-3 w-2/3 rounded-md opacity-50" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
