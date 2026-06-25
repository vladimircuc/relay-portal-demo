/**
 * Route-level loading UI for the client Ads dashboard.
 *
 * Next.js renders this instantly when a user navigates to /<slug>/ads,
 * BEFORE the page's server work (auth, client lookup, date bounds)
 * completes. Once `page.tsx` resolves, Next swaps this out for the real
 * content.
 *
 * The shape mirrors the real dashboard so the layout doesn't jump:
 *   - Header bar (logo / breadcrumb placeholder / user menu placeholder)
 *   - Period strip placeholder
 *   - Hero / Source+Funnel / Efficiency skeletons
 *
 * Result: clicking a client from the admin grid feels instant — the user
 * sees the dashboard frame appear immediately and the data populates as
 * each Suspense boundary resolves.
 */
import { Logo } from "@/components/logo";
import {
  HeroStatsSkeleton,
  SourceBreakdownSkeleton,
  FunnelSkeleton,
  EfficiencyStripSkeleton,
} from "@/components/skeletons";

export default function DashboardLoading() {
  return (
    <>
      {/* Header skeleton — sticky bar with logo + placeholder for breadcrumb
          and user menu. Matches DashboardHeader dimensions exactly. */}
      <header className="border-b border-[var(--surface-3)]/60 bg-[var(--surface-0)]/95 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-6 lg:px-12 h-16 flex items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <Logo size={28} />
            <div className="ps-skeleton h-5 w-32 rounded-md" />
          </div>
          <div className="flex items-center gap-5">
            <div className="ps-skeleton h-3 w-28 rounded-md opacity-50 hidden md:block" />
            <div className="ps-skeleton h-8 w-8 rounded-full" />
          </div>
        </div>
      </header>

      <main className="w-full px-6 lg:px-12 py-10 flex flex-col gap-8 lg:mx-auto lg:max-w-[90vw]">
        {/* Period strip placeholder — date-range picker + tier selector */}
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="ps-skeleton h-2.5 w-14 rounded-md opacity-60" />
            <div className="ps-skeleton h-11 w-[280px] rounded-lg" />
            <div className="ps-skeleton h-2.5 w-44 rounded-md opacity-40 mt-1.5" />
          </div>
          <div className="ps-skeleton h-9 w-[180px] rounded-md" />
        </section>

        <HeroStatsSkeleton />

        <section className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <SourceBreakdownSkeleton />
          <FunnelSkeleton />
        </section>

        <EfficiencyStripSkeleton cells={4} />
      </main>
    </>
  );
}
