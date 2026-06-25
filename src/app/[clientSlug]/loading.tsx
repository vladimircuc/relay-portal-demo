/**
 * Loading UI for the bare-slug segment (`/<slug>`), which immediately
 * redirects to `/<slug>/home`. This skeleton shows during that redirect
 * computation so the click registers instantly instead of hanging on the
 * previous page; Home's own loading.tsx then takes over for the real hop.
 *
 * It also serves as the fallback skeleton for any child segment that lacks
 * its own loading.tsx, so it's deliberately generic: the shared header bar
 * plus a faint body placeholder.
 */
import { Logo } from "@/components/logo";

function Box({ className = "" }: { className?: string }) {
  return <div className={`ps-skeleton ${className}`} />;
}

export default function ClientSegmentLoading() {
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

      <main className="w-[92vw] lg:w-[75vw] max-w-[1100px] mx-auto py-8 md:py-12 flex flex-col gap-6">
        <Box className="h-9 w-64 max-w-full rounded-lg" />
        <Box className="h-4 w-full max-w-xl rounded-md opacity-50" />
        <div className="grid gap-4 sm:grid-cols-2 mt-2">
          {[0, 1].map((i) => (
            <Box key={i} className="h-28 w-full rounded-[var(--radius-card)] opacity-60" />
          ))}
        </div>
      </main>
    </>
  );
}
