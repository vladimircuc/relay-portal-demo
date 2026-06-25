"use client";

/**
 * Submit buttons for server-action forms, with built-in loading feedback.
 *
 * Why this exists:
 *   Server actions don't expose any "submitting" state through Next's
 *   navigation API, so plain `<button type="submit">` looks dead while the
 *   round-trip is in flight. Even a 500ms action feels broken without a
 *   visual cue. These wrappers use React 19's `useFormStatus()` to detect
 *   the parent <form>'s pending state and render a spinner inline.
 *
 *   They ALSO light up the global top progress bar (via useNavProgress),
 *   so the user gets a viewport-level cue regardless of where on the page
 *   the form is.
 *
 *   `useFormStatus` only works when rendered INSIDE a <form> that uses
 *   `action={serverFn}`. Don't try to use these outside one.
 *
 * Three flavors covering every form on the admin pages:
 *   <SubmitPrimary>  — yellow "Save / Add" pill (the default action button)
 *   <SubmitIcon>     — icon-only (trash, remove, etc); spinner swaps in
 *   <SubmitLink>     — subtle "Clear / Pick a different pipeline" text link
 *
 * All three share: disabled-when-pending, aria-busy for screen readers,
 * and a global progress-bar nudge.
 */
import { useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNavProgress } from "../nav-progress";

// ─────────────────────────────────────────────────────────────────────────────
// Internal hook: while THIS form is pending, drive the global progress bar.

function useProgressBarOnPending(pending: boolean) {
  const nav = useNavProgress();
  useEffect(() => {
    if (pending) nav.start();
    else nav.stop();
  }, [pending, nav]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Primary yellow Save / Add button.

export function SubmitPrimary({
  children,
  pendingLabel = "Saving…",
  className,
  disabled,
}: {
  children: React.ReactNode;
  /** Text shown next to the spinner during the action. Default "Saving…". */
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  useProgressBarOnPending(pending);

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className={cn(
        "text-[13px] font-semibold px-4 py-2.5 rounded-md transition-colors min-w-[72px]",
        // The button itself is a flex row so the spinner sits beside the
        // label span. The label span is also inline-flex so any icon+text
        // INSIDE children (e.g. <Play /> + "Run backfill") line up too.
        "inline-flex items-center justify-center gap-2",
        // Default + hover look.
        "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)]",
        // Pending state is intentionally LOUD: a darker yellow, a clear
        // spinner, and cursor-wait. The yellow-dim swap is the strongest
        // visual cue that "this button is doing something right now".
        pending && "bg-[var(--ps-yellow-dim)] hover:bg-[var(--ps-yellow-dim)] cursor-wait",
        // Disabled-but-not-pending (e.g. Clear with nothing to clear).
        disabled && !pending && "opacity-50 cursor-not-allowed hover:bg-[var(--ps-yellow)]",
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

// ─────────────────────────────────────────────────────────────────────────────
// Icon-only button (e.g. trash to remove a row). The provided icon child
// is swapped for a spinning Loader2 during pending.

export function SubmitIcon({
  children,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  useProgressBarOnPending(pending);

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={ariaLabel}
      className={cn(
        "p-1 rounded transition-colors inline-flex items-center justify-center",
        "text-[var(--text-tertiary)] hover:text-[var(--negative)]",
        (disabled || pending) && "opacity-60 cursor-wait hover:text-[var(--text-tertiary)]",
        className,
      )}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subtle text-link style submit (Clear, Pick a different pipeline).

export function SubmitLink({
  children,
  pendingLabel = "Working…",
  className,
  disabled,
  tone = "neutral",
  formAction,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  /** Neutral hover color, or "danger" for destructive-style links (Clear). */
  tone?: "neutral" | "danger";
  /**
   * React 19's `formAction` button prop. When set, clicking this button
   * runs the given action with the parent form's FormData instead of
   * the form's own `action`. Lets us put a Clear button inside a Save
   * form without nesting <form>s (which React 19 flags as a hydration
   * error and HTML doesn't allow).
   */
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  useProgressBarOnPending(pending);

  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={disabled || pending}
      aria-busy={pending}
      className={cn(
        "text-[12px] inline-flex items-center gap-1.5 underline-offset-2 hover:underline transition-colors",
        tone === "danger"
          ? "text-[var(--text-tertiary)] hover:text-[var(--negative)]"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
        (disabled || pending) && "opacity-50 cursor-wait hover:no-underline",
        className,
      )}
    >
      {pending && <Loader2 size={12} className="animate-spin" />}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  );
}
