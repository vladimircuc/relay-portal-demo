import Link from "next/link";
import { Logo } from "@/components/ui";
import { DemoChip } from "@/components/info";
import { DEMO_USER } from "@/lib/demo-data";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <Link href="/clients" className="transition hover:opacity-80">
              <Logo size={28} word />
            </Link>
            <DemoChip>demo</DemoChip>
          </div>
          <div className="flex items-center gap-3 text-sm sm:gap-4">
            <Link href="/clients" className="hidden text-dim hover:text-ink sm:inline">
              Clients
            </Link>
            <span className="hidden items-center gap-2 md:flex">
              <span className="text-dim">{DEMO_USER.email}</span>
              <span className="rounded-full border border-border-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
                {DEMO_USER.role}
              </span>
            </span>
            <Link
              href="/"
              className="rounded-md border border-border-2 px-3 py-1.5 text-xs text-dim transition hover:text-ink"
            >
              Sign out
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
