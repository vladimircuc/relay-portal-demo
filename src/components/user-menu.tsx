"use client";

/**
 * Account dropdown — pinned to the top-right of every header.
 *
 * Shows the signed-in email + a Sign-out button. Kept deliberately
 * minimal: privileged actions (managing client lifecycle, credentials,
 * etc.) live inside the per-client /<slug>/admin surface, not here.
 */
import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

export function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const initial = email.charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-9 w-9 rounded-full bg-[var(--surface-2)] border border-[var(--surface-3)] hover:bg-[var(--surface-3)] flex items-center justify-center text-sm font-semibold text-[var(--text-primary)] transition-colors"
        aria-label="Account menu"
      >
        {initial}
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-full mt-2 z-50 min-w-[240px]",
            "bg-[var(--surface-1)] border border-[var(--surface-3)]/60 rounded-lg",
            "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] overflow-hidden",
          )}
        >
          <div className="px-4 py-3 border-b border-[var(--surface-3)]/40">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-0.5">
              Signed in as
            </div>
            <div className="text-sm font-medium text-[var(--text-primary)] truncate">
              {email}
            </div>
          </div>

          <button
            onClick={signOut}
            className="w-full px-4 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] flex items-center gap-2.5 transition-colors"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
