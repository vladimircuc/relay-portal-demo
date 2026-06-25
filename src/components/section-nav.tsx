/**
 * Home / Ads / Socials section switcher for the header breadcrumb.
 *
 * Looks like the shared <Segmented> control (solid-yellow active, no glow) but
 * is NAVIGATION, not state — each segment is a real link, so it works as a
 * server component and drives the nav-progress bar via <ProgressLink>.
 *
 * Home is always present and leftmost (the universal landing). The product
 * segments (Ads / Socials) are DATA-DRIVEN from `sections` — the client's
 * enabled_services as resolved by visibleSections() — so a client only ever
 * sees the tabs it's entitled to. This component carries no visibility logic
 * of its own; the caller decides what to pass.
 */
import { Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { ProgressLink } from "./progress-link";
import type { Capability } from "@/lib/auth";

export type DashboardSection = "home" | "ads" | "socials" | "web";

/** Every product tab, canonical order. ALL of these now render for EVERY client
 *  — tabs the client doesn't own open a locked teaser rather than redirecting,
 *  so the nav is identical for everyone (locked tabs just get a small lock). */
const PRODUCTS: Capability[] = ["ads", "socials", "web"];

/** Display labels for the product segments. Home is hardcoded. Exported so the
 *  mobile nav drawer renders the same labels as the desktop tab pills. */
export const PRODUCT_LABELS: Record<Capability, string> = {
  ads: "Ads",
  socials: "Socials",
  web: "Web & SEO",
};

/** URL segment per product. The Web & SEO product keeps the historical `/seo`
 *  route (its dashboard folder, ETL pull, and period cookie are all named
 *  "seo"), so the capability value ("web") and the route ("seo") diverge only
 *  here — every consumer that builds a product href goes through this map. */
export const PRODUCT_ROUTE: Record<Capability, string> = {
  ads: "ads",
  socials: "socials",
  web: "seo",
};

export function SectionNav({
  slug,
  active,
  sections,
}: {
  slug: string;
  active: DashboardSection;
  /**
   * The product tabs this client OWNS (entitled, from visibleSections). ALL
   * products render regardless; those not in this list show a small lock and
   * open the locked teaser instead of the live dashboard.
   */
  sections: Capability[];
}) {
  const items: Array<{ key: DashboardSection; label: string; href: string; locked: boolean }> = [
    { key: "home", label: "Home", href: `/${slug}/home`, locked: false },
    ...PRODUCTS.map((s) => ({
      key: s,
      label: PRODUCT_LABELS[s],
      href: `/${slug}/${PRODUCT_ROUTE[s]}`,
      locked: !sections.includes(s),
    })),
  ];
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[var(--surface-1)] border border-[var(--surface-3)]/60">
      {items.map((it) => {
        const isActive = it.key === active;
        return (
          <ProgressLink
            key={it.key}
            href={it.href}
            aria-current={isActive ? "page" : undefined}
            title={it.locked ? `${it.label} — not in your plan yet` : undefined}
            className={cn(
              // `transition-all` (not just colors) so the bg-fill + lock micro-
              // interaction ease in. `active:` gives a subtle press on tap.
              "group relative inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-md transition-all duration-150 active:scale-[0.97]",
              isActive
                ? "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)]"
                : it.locked
                  // Locked → "premium" hover: a faint brand-yellow wash with the
                  // label + lock warming to the accent colour. Reads as
                  // "available to unlock" — distinct from an owned tab.
                  ? "text-[var(--text-tertiary)] hover:bg-[var(--ps-yellow)]/12 hover:text-[var(--accent-fg)]"
                  // Owned → clean neutral hover: a surface fill + brighter label,
                  // the standard "this is a real tab you can open" feel.
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]",
            )}
          >
            {it.label}
            {it.locked && (
              <Lock
                size={11}
                aria-hidden
                className={cn(
                  "transition-all duration-150",
                  isActive
                    ? "opacity-80"
                    // Inherits the accent colour from the parent's hover:text;
                    // the pop + brighten signals interactivity on the lock itself.
                    : "opacity-60 group-hover:opacity-100 group-hover:scale-110",
                )}
              />
            )}
          </ProgressLink>
        );
      })}
    </div>
  );
}
