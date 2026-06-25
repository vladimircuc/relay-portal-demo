"use client";

/**
 * "How it works in production" explainer — the demo's way of showing how a real
 * feature was built + secured without actually running it. Modeled on the app's
 * ProjectionExplainer: a portal modal with an icon header, a structured
 * "in production" step list, and an optional security callout (no walls of text).
 *
 * Three triggers:
 *   <HowItWorks {...content}>{(open) => <button onClick={open}/>}</HowItWorks>  — wrap any button
 *   <HowItWorksTip label="…" {...content} />                                    — a subtle ⓘ pill
 *   <HowItWorksIcon {...content} />                                             — a bare ⓘ icon (tile-style)
 */
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info, X, ShieldCheck, type LucideIcon } from "lucide-react";

type Step = { title: string; body: ReactNode };

export type ExplainerContent = {
  title: string;
  Icon?: LucideIcon;
  intro?: ReactNode;
  steps?: Step[];
  security?: { title?: string; body: ReactNode };
  footnote?: string;
};

function Modal({ title, Icon, intro, steps, security, footnote, onClose }: ExplainerContent & { onClose: () => void }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[var(--surface-0)]/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[520px] max-h-[85vh] overflow-y-auto bg-[var(--surface-1)] border border-[var(--surface-3)]/60 rounded-[var(--radius-card)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--surface-3)]/40 bg-[var(--surface-1)] px-6 py-4">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--accent-fg)]/12 text-[var(--accent-fg)]">
                <Icon size={17} />
              </span>
            )}
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-6">
          {intro && <p className="text-[13.5px] leading-relaxed text-[var(--text-secondary)]">{intro}</p>}

          {steps && steps.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)]">In production</div>
              <ol className="flex flex-col gap-2.5">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-3 rounded-md border border-[var(--surface-3)]/50 bg-[var(--surface-2)]/40 p-3">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--accent-fg)]/15 text-[10px] font-bold text-[var(--accent-fg)]">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[var(--text-primary)]">{s.title}</div>
                      <div className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{s.body}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {security && (
            <div className="rounded-md border border-[var(--accent-fg)]/25 bg-[var(--accent-fg)]/[0.06] p-4">
              <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
                <ShieldCheck size={15} className="text-[var(--accent-fg)]" />
                {security.title ?? "How it's secured"}
              </div>
              <p className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{security.body}</p>
            </div>
          )}

          <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
            {footnote ?? "Demo — this button doesn't run the real action."}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Controlled modal — render directly with your own open/close state. Used by the
 * /admin <DemoActionInterceptor>, which decides which explainer to show based on
 * the form a visitor submitted rather than a per-button trigger.
 */
export function HowItWorksModal({ content, onClose }: { content: ExplainerContent; onClose: () => void }) {
  return <Modal {...content} onClose={onClose} />;
}

/** Render-prop trigger — wrap any button so it opens the explainer instead of acting. */
export function HowItWorks({ children, ...content }: ExplainerContent & { children: (open: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children(() => setOpen(true))}
      {open && <Modal {...content} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Subtle ⓘ pill — for section headers and the login. */
export function HowItWorksTip({ label = "How it works", ...content }: ExplainerContent & { label?: string }) {
  return (
    <HowItWorks {...content}>
      {(open) => (
        <button
          type="button"
          onClick={open}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--surface-3)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-fg)]/40 hover:text-[var(--accent-fg)]"
        >
          <Info size={12} className="text-[var(--accent-fg)]" />
          {label}
        </button>
      )}
    </HowItWorks>
  );
}

/** Bare ⓘ icon — matches the app's inline tile info-icons. */
export function HowItWorksIcon(content: ExplainerContent) {
  return (
    <HowItWorks {...content}>
      {(open) => (
        <button
          type="button"
          onClick={open}
          aria-label={content.title}
          className="inline-grid h-5 w-5 place-items-center rounded-full text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--accent-fg)]"
        >
          <Info size={14} />
        </button>
      )}
    </HowItWorks>
  );
}
