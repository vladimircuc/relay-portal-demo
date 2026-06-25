"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { FixedThemeToggle } from "@/components/ui/theme-toggle";

export default function NoAccessPage() {
  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[var(--surface-0)]">
      <FixedThemeToggle />
      <div className="w-full max-w-md flex flex-col gap-8">
        <Logo size={36} />

        <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-10 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              No Dashboard Access
            </h1>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Your email isn&apos;t authorized to view any client dashboards. If you
              think this is a mistake, contact your Relay representative.
            </p>
          </div>

          <button
            onClick={signOut}
            className="inline-flex items-center justify-center h-10 rounded-lg bg-[var(--surface-2)] text-[var(--text-primary)] border border-[var(--surface-3)] hover:bg-[var(--surface-3)] transition-colors text-sm font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    </main>
  );
}
