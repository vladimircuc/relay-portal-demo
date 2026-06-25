"use client";

/**
 * Type-the-slug-to-confirm permanent-delete form.
 *
 * The submit button is disabled until what the user typed (case-
 * insensitive, trimmed) matches the client's slug. Both sides of the
 * comparison get normalised so muscle-memory variants like "Test-Client"
 * and "test-client " resolve the same way.
 *
 * UX safeguards:
 *   - A live "✓ Ready" indicator appears next to the input the moment
 *     the match goes through. The previous version of this form relied
 *     solely on the button's disabled→enabled visual transition, which
 *     was too subtle to notice — easy to think the form was broken
 *     when you'd actually typed something slightly off.
 *   - The submit button toggles between a clearly-faded disabled state
 *     and a loud solid red when ready.
 *   - Server-side validation re-checks the typed match, so a
 *     hand-crafted POST that skips the input can't bypass the gate.
 *
 * Once submitted, the action runs cascade-delete on every related table
 * and redirects to /clients. No undo.
 */
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { permanentlyDeleteClient } from "./client-status-actions";
import { useNavProgress } from "../nav-progress";

type Props = {
  clientId: string;
  clientName: string;
  clientSlug: string;
};

/**
 * Forgiving comparison: trim whitespace + lowercase both sides. Slugs are
 * already lowercase per the createClient action, so this only loosens
 * for typos like "  test-client" (leading space from a copy-paste).
 */
function normalise(s: string): string {
  return s.trim().toLowerCase();
}

export function PermanentDeleteForm({ clientId, clientName, clientSlug }: Props) {
  const [typed, setTyped] = useState("");
  const matches = typed.length > 0 && normalise(typed) === normalise(clientSlug);

  return (
    <form action={permanentlyDeleteClient} className="flex flex-col gap-3">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="clientSlug" value={clientSlug} />

      <label className="flex flex-col gap-1.5 max-w-md">
        <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
          Type{" "}
          <code className="font-mono text-[var(--text-primary)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">
            {clientSlug}
          </code>{" "}
          to confirm
        </span>
        <div className="relative">
          <input
            name="slugConfirm"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={clientSlug}
            className={cn(
              "bg-[var(--surface-2)] border rounded-md px-3 py-2 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none w-full font-mono transition-colors",
              matches
                ? "border-[var(--positive)]/60 focus:border-[var(--positive)]"
                : "border-[var(--surface-3)]/60 focus:border-[var(--negative)]",
            )}
          />
          {/* Live match indicator — the missing visual feedback that made
              the previous version of this form feel broken. */}
          {matches && (
            <CheckCircle2
              size={16}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--positive)]"
              aria-label="Confirmation matches"
            />
          )}
        </div>
      </label>

      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <DeleteButton ready={matches} />
        <span className="text-[11px] text-[var(--text-tertiary)]">
          Permanently deletes <span className="text-[var(--text-secondary)]">{clientName}</span> and every related row. <strong className="text-[var(--negative)]">No undo.</strong>
        </span>
      </div>
    </form>
  );
}

/**
 * Destructive submit button. Heavily faded in the disabled state, loud
 * solid red in the ready state — designed so the moment-of-truth state
 * change is unmistakable.
 */
function DeleteButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  const nav = useNavProgress();
  useEffect(() => {
    if (pending) nav.start();
    else nav.stop();
  }, [pending, nav]);

  return (
    <button
      type="submit"
      disabled={!ready || pending}
      aria-busy={pending}
      className={cn(
        "text-[13px] font-semibold px-4 py-2.5 rounded-md transition-colors inline-flex items-center justify-center gap-2 min-w-[180px]",
        // Ready state — loud solid red.
        ready && !pending && "bg-[var(--negative)] text-white hover:bg-[color-mix(in_oklab,var(--negative)_85%,black)]",
        // Pending state — solid red still but cursor-wait.
        pending && "bg-[var(--negative)] text-white cursor-wait",
        // Not-ready — heavily faded so the disabled→ready transition is dramatic.
        !ready && !pending && "bg-[var(--negative)]/25 text-white/60 cursor-not-allowed",
      )}
    >
      {pending ? (
        <Loader2 size={14} className="animate-spin" aria-hidden />
      ) : (
        <Trash2 size={14} aria-hidden />
      )}
      <span>{pending ? "Deleting…" : "Permanently delete"}</span>
    </button>
  );
}
