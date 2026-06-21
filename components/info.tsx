"use client";

import { useState, type ReactNode } from "react";

function InfoDot() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

/**
 * The "how I built this" affordance. Click it and a popover explains how the
 * feature was actually implemented in production + the security around it. The
 * underlying button never performs the real action — this demo has no backend.
 */
export function InfoPopover({
  title,
  children,
  label = "How I built this",
  align = "left",
}: {
  title: string;
  children: ReactNode;
  label?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-border-2 bg-surface px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-accent transition hover:bg-surface-2"
      >
        <InfoDot />
        {label}
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <span
            className={`absolute top-full z-40 mt-2 block w-[22rem] max-w-[80vw] ${align === "right" ? "right-0" : "left-0"}`}
          >
            <span className="block rounded-xl border border-border-2 bg-surface p-4 text-left shadow-2xl shadow-black/60">
              <span className="block text-xs font-semibold">
                <span className="grad-text">{title}</span>
              </span>
              <span className="mt-2 block text-xs leading-relaxed text-dim">{children}</span>
              <span className="mt-3 block font-mono text-[10px] uppercase tracking-wider text-faint">
                production implementation · not live in this demo
              </span>
            </span>
          </span>
        </>
      )}
    </span>
  );
}

/** Small inline "DEMO" chip. */
export function DemoChip({ children = "demo" }: { children?: ReactNode }) {
  return (
    <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">
      {children}
    </span>
  );
}
