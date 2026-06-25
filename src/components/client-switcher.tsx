"use client";

/**
 * Client switcher dropdown — visible only to admin / super-admin. Lets them
 * pick which client's dashboard to view.
 *
 * When the parent passes `section`, we preserve it on switch: someone on
 * `/varble/admin` who picks "Acme" lands on `/acme/admin`, not on
 * `/acme/home`. Same for any future module (`/varble/seo` → `/acme/seo`).
 * Without `section`, we route to bare `/<slug>` which redirects to that
 * client's Home tab. (If the preserved section isn't enabled for the new
 * client — e.g. switching to an ads-only client while on Socials — the
 * target page's entitlement guard bounces to Home, so the switch is safe.)
 */
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, Check, Building2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ProgressLink } from "./progress-link";
import { ClientLogo } from "./client-logo";

/**
 * Item shape for the dropdown — enough to render a small ClientLogo
 * (which only needs name + slug + the two brand fields) alongside the
 * client name. Parent passes the same shape it gets from auth.ts.
 */
export type SwitcherClient = {
  slug: string;
  name: string;
  brand_logo_url?: string | null;
  brand_accent_color?: string | null;
};

type Props = {
  activeSlug: string;
  clients: SwitcherClient[];
};

export function ClientSwitcher({ activeSlug, clients }: Props) {
  const pathname = usePathname();
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

  // Close the menu once the switch has LANDED — when the new client's page
  // re-renders the header with a different activeSlug. (Same ref-guarded pattern
  // as TopProgress's prevPath in nav-progress.tsx.)
  //
  // Why not close on click: setOpen(false) on click is an urgent update that
  // unmounts the clicked <ProgressLink> (and its <LinkPending>) BEFORE Next's
  // navigation transition commits, so useLinkStatus() never flips to pending and
  // the top progress bar is held only by nav.start()'s manual timer — which
  // expires partway through a slow (stale-session) switch, leaving dead air with
  // no loading indicator. Keeping the row mounted until the destination renders
  // lets <LinkPending> hold the bar lit for the WHOLE navigation. (Outside-click
  // above and the active-row button below still close instantly.)
  const prevSlugRef = useRef(activeSlug);
  useEffect(() => {
    if (prevSlugRef.current !== activeSlug) {
      prevSlugRef.current = activeSlug;
      setOpen(false);
    }
  }, [activeSlug]);

  // Switch target: preserve the section the admin is currently ON by reusing the
  // CURRENT URL's section segment (e.g. "seo", "ads", "admin") — NOT a lowercased
  // breadcrumb label, since labels like "Web & SEO" don't match their route
  // ("/seo"). If that section isn't enabled for the new client, its page guard
  // bounces to Home; on a bare `/<slug>` we route there and let it redirect.
  const currentSection = pathname.split("/").filter(Boolean)[1] ?? null;
  const targetFor = (slug: string) =>
    currentSection ? `/${slug}/${currentSection}` : `/${slug}`;

  const active = clients.find((c) => c.slug === activeSlug);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        // Asymmetric padding (less on left) so the button visually
        // attaches to the client logo that the parent renders just
        // before it, rather than floating in space with empty padding
        // between them.
        className="hidden sm:flex items-center gap-2 px-2 h-9 rounded-md text-sm text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
      >
        <span className="font-medium">{active?.name ?? "Select client"}</span>
        <ChevronDown size={14} className="text-[var(--text-tertiary)]" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 top-full mt-2 z-50 min-w-[240px] max-h-[60vh] overflow-auto",
            "bg-[var(--surface-1)] border border-[var(--surface-3)]/60 rounded-lg",
            "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] p-1.5",
          )}
        >
          <div className="px-3 pt-2 pb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Switch client
          </div>
          {clients.map((c) => {
            const isActive = c.slug === activeSlug;
            const rowClass = cn(
              "w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2.5",
              isActive
                ? "bg-[var(--surface-2)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]",
            );
            const row = (
              <>
                <ClientLogo client={c} size={20} />
                <span className="flex-1 truncate">{c.name}</span>
                {isActive && <Check size={14} className="text-[var(--accent-fg)] shrink-0" />}
              </>
            );
            // Already on this client → just close the menu (no navigation).
            // Otherwise a ProgressLink with NO onClick-close: closing the menu on
            // click would unmount this link before Next's navigation transition
            // commits, which is exactly what kept useLinkStatus from ever firing —
            // so the top bar died at its manual-timer cap partway through the
            // switch. We instead leave the row mounted and close the menu when the
            // switch lands (the activeSlug effect above), so <LinkPending> holds
            // the progress bar lit for the entire navigation — including the slow
            // stale-session token refresh.
            return isActive ? (
              <button key={c.slug} type="button" onClick={() => setOpen(false)} className={rowClass}>
                {row}
              </button>
            ) : (
              <ProgressLink
                key={c.slug}
                href={targetFor(c.slug)}
                className={rowClass}
              >
                {row}
              </ProgressLink>
            );
          })}
          <div className="border-t border-[var(--surface-3)]/40 mt-1.5 pt-1.5">
            <ProgressLink
              href="/clients"
              className="w-full px-3 py-2 rounded-md text-sm flex items-center gap-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
            >
              <Building2 size={14} />
              All clients
            </ProgressLink>
          </div>
        </div>
      )}
    </div>
  );
}
