/**
 * Loading UI for the "Add a client" page.
 *
 * The page runs auth + super-admin gating on the server before rendering the
 * form, so without this file the click hung on the clients list. Next shows
 * this skeleton instantly and swaps in the real form when page.tsx resolves.
 *
 * Mirrors the page chrome: header (logo + user menu) and the narrow 640px
 * column with a back-link, eyebrow, title, intro, and a form placeholder.
 */
import { Logo } from "@/components/logo";

function Box({ className = "" }: { className?: string }) {
  return <div className={`ps-skeleton ${className}`} />;
}

export default function NewClientLoading() {
  return (
    <>
      <header className="border-b border-[var(--surface-3)]/60 bg-[var(--surface-0)]/95 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-6 lg:px-12 h-16 flex items-center justify-between gap-6">
          <Logo size={28} />
          <Box className="h-8 w-8 rounded-full" />
        </div>
      </header>

      <main className="w-full max-w-[640px] mx-auto px-6 py-10 flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Box className="h-4 w-28 rounded-md opacity-50 mb-2" />
          <Box className="h-2.5 w-14 rounded-md opacity-40" />
          <Box className="h-8 w-48 rounded-lg" />
          <Box className="h-3.5 w-full max-w-md rounded-md opacity-50 mt-1" />
        </div>

        {/* Form placeholder — a handful of labelled fields + submit. */}
        <div className="flex flex-col gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Box className="h-2.5 w-24 rounded-md opacity-50" />
              <Box className="h-11 w-full rounded-lg" />
            </div>
          ))}
          <Box className="h-11 w-40 rounded-lg mt-2" />
        </div>
      </main>
    </>
  );
}
