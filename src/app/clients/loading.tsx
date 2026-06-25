/**
 * Route-level loading UI for the super-admin clients list.
 *
 * Shown while the page's server work (auth + super-admin check + fetch of
 * all active clients) is in flight. Mirrors the real page layout — header,
 * heading block, and a 3-column grid of card skeletons — so the layout
 * doesn't jump when the data lands.
 */
import { Logo } from "@/components/logo";

export default function ClientsLoading() {
  return (
    <>
      <header className="border-b border-[var(--surface-3)]/60 bg-[var(--surface-0)]/95 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-6 lg:px-12 h-16 flex items-center justify-between gap-6">
          <Logo size={28} />
          <div className="ps-skeleton h-8 w-8 rounded-full" />
        </div>
      </header>

      <main className="w-full max-w-[1100px] mx-auto px-6 lg:px-12 py-12 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <div className="ps-skeleton h-2.5 w-14 rounded-md opacity-60" />
          <div className="ps-skeleton h-8 w-40 rounded-md" />
          <div className="ps-skeleton h-4 w-72 rounded-md opacity-60 mt-1.5" />
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-6"
            >
              <div className="flex flex-col gap-2">
                <div className="ps-skeleton h-2 w-10 rounded-md opacity-60" />
                <div className="ps-skeleton h-5 w-3/4 rounded-md" />
                <div className="ps-skeleton h-2.5 w-1/2 rounded-md opacity-50" />
              </div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
