"use client";

/**
 * Mobile navigation — the hamburger + slide-in drawer that replaces the
 * desktop header's inline tab pills + client switcher on phones (<md).
 *
 * The desktop header hides the SectionNav and ClientSwitcher below md, which
 * left phones with NO way to change tab or client. This drawer restores both:
 *   - the 4 product tabs (Home / Ads / Socials / Web & SEO), with the same lock
 *     badge for tabs the client doesn't own (it opens the locked teaser, same
 *     as desktop);
 *   - the admin client switcher (when provided);
 *   - a Settings link (admin only — the desktop gear is also hidden <md).
 *
 * Reuses the open/close conventions from ClientSwitcher: outside-click + Escape
 * close instantly, but navigation rows are <ProgressLink>s left mounted (no
 * onClick-close) so the top progress bar holds for the whole transition; the
 * drawer then closes when the destination renders (the active/slug effect).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Menu, X, Check, Building2, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { ProgressLink } from "./progress-link";
import { ClientLogo } from "./client-logo";
import { PRODUCT_ROUTE, PRODUCT_LABELS, type DashboardSection } from "./section-nav";
import type { Capability } from "@/lib/auth";
import type { SwitcherClient } from "./client-switcher";

const PRODUCTS: Capability[] = ["ads", "socials", "web"];

export function MobileNav({
  slug,
  active,
  sections,
  client,
  switcher,
}: {
  slug: string;
  active: DashboardSection;
  sections: Capability[];
  client: { name: string; slug: string; brand_logo_url?: string | null; brand_accent_color?: string | null };
  switcher?: { activeSlug: string; clients: SwitcherClient[] };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Escape-to-close + lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Close once a navigation LANDS (active tab or client changed) — same rationale
  // as ClientSwitcher: closing on click would unmount the ProgressLink before the
  // transition commits and drop the progress bar.
  const activeSlug = switcher?.activeSlug ?? slug;
  const prevKey = useRef(`${active}:${activeSlug}`);
  useEffect(() => {
    const key = `${active}:${activeSlug}`;
    if (prevKey.current !== key) {
      prevKey.current = key;
      setOpen(false);
    }
  }, [active, activeSlug]);

  const tabs: Array<{ key: DashboardSection; label: string; href: string; locked: boolean }> = [
    { key: "home", label: "Home", href: `/${slug}/home`, locked: false },
    ...PRODUCTS.map((s) => ({
      key: s as DashboardSection,
      label: PRODUCT_LABELS[s],
      href: `/${slug}/${PRODUCT_ROUTE[s]}`,
      locked: !sections.includes(s),
    })),
  ];

  // Preserve the current section when switching client (mirrors ClientSwitcher).
  const currentSection = pathname.split("/").filter(Boolean)[1] ?? null;
  const targetFor = (s: string) => (currentSection ? `/${s}/${currentSection}` : `/${s}`);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden flex h-9 w-9 -ml-1.5 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] transition-colors"
        aria-label="Open menu"
        aria-expanded={open}
      >
        <Menu size={20} />
      </button>

      {/* Portaled to <body>: the header has `backdrop-blur`, and backdrop-filter
          makes an element the containing block for fixed descendants — so a
          drawer rendered inline would be clipped to the 64px header instead of
          filling the viewport. (Same reason CreateReportButton portals its modal.)
          `open` is only ever true after a client click, so document is defined. */}
      {open && createPortal(
        <div className="md:hidden fixed inset-0 z-50">
          {/* Backdrop — tap to close. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          {/* Panel. */}
          <div className="absolute inset-y-0 left-0 w-[82vw] max-w-[310px] bg-[var(--surface-1)] border-r border-[var(--surface-3)]/60 shadow-[0_0_60px_rgba(0,0,0,0.6)] flex flex-col">
            <div className="flex items-center gap-2.5 px-4 h-16 border-b border-[var(--surface-3)]/50 shrink-0">
              <ClientLogo client={client} size={26} />
              <span className="flex-1 truncate text-[15px] font-semibold text-[var(--text-primary)]">{client.name}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="h-8 w-8 flex items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-1">
              <div className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Dashboard</div>
              {tabs.map((t) => {
                const isActive = t.key === active;
                const cls = cn(
                  "flex items-center w-full text-left px-3 h-11 rounded-lg text-[15px] font-medium transition-colors",
                  isActive
                    ? "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)]"
                    : t.locked
                      ? "text-[var(--text-tertiary)] hover:bg-[var(--surface-2)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]",
                );
                const body = (
                  <>
                    <span className="flex-1">{t.label}</span>
                    {t.locked && <Lock size={13} className="opacity-70" aria-hidden />}
                  </>
                );
                return isActive ? (
                  <button key={t.key} type="button" onClick={() => setOpen(false)} className={cls}>
                    {body}
                  </button>
                ) : (
                  <ProgressLink
                    key={t.key}
                    href={t.href}
                    className={cls}
                    title={t.locked ? `${t.label} — not in your plan yet` : undefined}
                  >
                    {body}
                  </ProgressLink>
                );
              })}

              {switcher && switcher.clients.length > 1 && (
                <>
                  <div className="px-2 pt-4 pb-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Switch client</div>
                  {switcher.clients.map((c) => {
                    const isActive = c.slug === switcher.activeSlug;
                    const cls = cn(
                      "flex items-center gap-2.5 w-full text-left px-3 h-11 rounded-lg text-[14px]",
                      isActive
                        ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]",
                    );
                    const body = (
                      <>
                        <ClientLogo client={c} size={20} />
                        <span className="flex-1 truncate">{c.name}</span>
                        {isActive && <Check size={14} className="text-[var(--accent-fg)] shrink-0" />}
                      </>
                    );
                    return isActive ? (
                      <button key={c.slug} type="button" onClick={() => setOpen(false)} className={cls}>
                        {body}
                      </button>
                    ) : (
                      <ProgressLink key={c.slug} href={targetFor(c.slug)} className={cls}>
                        {body}
                      </ProgressLink>
                    );
                  })}
                  <ProgressLink
                    href="/clients"
                    className="flex items-center gap-2.5 px-3 h-11 rounded-lg text-[14px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                  >
                    <Building2 size={14} /> All clients
                  </ProgressLink>
                </>
              )}
            </nav>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
