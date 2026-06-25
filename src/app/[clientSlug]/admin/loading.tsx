/**
 * Route-level loading UI for the per-client admin page.
 *
 * Mirrors the real admin layout so the click feels instant: header
 * placeholder, title placeholder, three section-card placeholders.
 */
import { Logo } from "@/components/logo";

export default function AdminLoading() {
  return (
    <>
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
        <div className="flex flex-col gap-2">
          <div className="ps-skeleton h-2.5 w-14 rounded-md opacity-60" />
          <div className="ps-skeleton h-8 w-48 rounded-md" />
          <div className="ps-skeleton h-4 w-96 rounded-md opacity-60 mt-1.5" />
        </div>

        {[0, 1, 2].map((i) => (
          <section
            key={i}
            className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-3"
          >
            <div className="ps-skeleton h-6 w-32 rounded-md" />
            <div className="ps-skeleton h-3 w-3/4 rounded-md opacity-60" />
          </section>
        ))}
      </main>
    </>
  );
}
