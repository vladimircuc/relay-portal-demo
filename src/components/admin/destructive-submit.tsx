"use client";

/**
 * Secondary destructive submit button.
 *
 * Same shape and dimensions as SubmitPrimary, but ghost-styled with red
 * text + a red border instead of a filled yellow background. Sits in
 * action rows next to the primary action without competing for
 * attention while still reading clearly as "this one's destructive."
 *
 *   Primary (Pause)   →  filled yellow      SubmitPrimary
 *   Secondary (Delete) →  red outline       DestructiveSubmit
 *   Nuclear (Permanently delete) →  filled red, gated by typed slug
 *
 * Drives the global progress bar via useNavProgress (same pattern as
 * SubmitPrimary) so all admin form submits feel consistent.
 */
import { useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNavProgress } from "../nav-progress";

export function DestructiveSubmit({
  children,
  pendingLabel = "Working…",
  className,
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const nav = useNavProgress();
  useEffect(() => {
    if (pending) nav.start();
    else nav.stop();
  }, [pending, nav]);

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className={cn(
        "text-[13px] font-semibold px-4 py-2.5 rounded-md transition-colors min-w-[72px]",
        "inline-flex items-center justify-center gap-2",
        // Resting state — red text on a faint red-tinted background with
        // matching border. Hover fills the surface for a stronger danger
        // signal without ever competing with the yellow primary at rest.
        "text-[var(--negative)] border border-[var(--negative)]/40 bg-[var(--negative)]/5",
        "hover:bg-[var(--negative)]/15 hover:border-[var(--negative)]/60",
        // Pending — switch to filled red so the action's nature is
        // unmistakable while it's running.
        pending && "bg-[var(--negative)] border-[var(--negative)] text-white cursor-wait hover:bg-[var(--negative)]",
        disabled && !pending && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {pending && (
        <Loader2 size={16} className="animate-spin shrink-0" aria-hidden />
      )}
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {pending ? pendingLabel : children}
      </span>
    </button>
  );
}
