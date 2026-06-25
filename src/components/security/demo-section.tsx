import { ShieldCheck, Lightbulb, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** A friendly, non-technical decoder shown above each demo's controls. */
export type PlainEnglish = {
  gist: ReactNode; // the analogy / what's at stake, one or two sentences
  youTry: ReactNode; // what the attack/button actually does
  blocked: ReactNode; // what it means when the defense stops it
};

/**
 * Shared chrome for each Security Lab demo: a numbered header (icon + title +
 * one-line scenario), an always-visible "in plain English" panel so a
 * non-technical visitor gets it before the technical bits, the interactive
 * body, and a one-line takeaway footer. Each demo supplies its own animated
 * body as `children`.
 */
export function DemoSection({
  n,
  Icon,
  title,
  scenario,
  plain,
  takeaway,
  children,
}: {
  n: number;
  Icon: LucideIcon;
  title: string;
  scenario: ReactNode;
  plain: PlainEnglish;
  takeaway: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--surface-3)]/50 bg-[var(--surface-1)]">
      <div className="flex items-start gap-4 border-b border-[var(--surface-3)]/40 p-6 sm:p-7">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-yellow)]/12 text-[var(--accent-fg)]">
          <Icon size={21} />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            Demo {n}
          </div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">{title}</h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{scenario}</p>
        </div>
      </div>

      <div className="p-6 sm:p-7">
        {/* Plain-English decoder — so a non-technical visitor gets the gist
            before the interactive (and more technical) test below. */}
        <div className="mb-6 rounded-md border border-[var(--ps-yellow)]/25 bg-[var(--ps-yellow)]/[0.05] p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-fg)]">
            <Lightbulb size={13} /> In plain English
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{plain.gist}</p>
          <div className="mt-3 flex flex-col gap-1.5 text-[12.5px] leading-relaxed">
            <div>
              <span className="font-semibold text-[var(--text-primary)]">You try: </span>
              <span className="text-[var(--text-secondary)]">{plain.youTry}</span>
            </div>
            <div>
              <span className="font-semibold text-[var(--text-primary)]">If it&apos;s blocked: </span>
              <span className="text-[var(--text-secondary)]">{plain.blocked}</span>
            </div>
          </div>
        </div>

        {children}
      </div>

      <div className="flex items-start gap-2.5 border-t border-[var(--surface-3)]/40 bg-[var(--surface-2)]/30 px-6 py-4 sm:px-7">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--accent-fg)]" />
        <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">Takeaway — </span>
          {takeaway}
        </p>
      </div>
    </section>
  );
}
