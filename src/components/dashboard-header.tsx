import { Settings } from "lucide-react";
import { Logo } from "./logo";
import { ClientLogo } from "./client-logo";
import { ClientSwitcher, type SwitcherClient } from "./client-switcher";
import { UserMenu } from "./user-menu";
import { ProgressLink } from "./progress-link";
import { SectionNav, type DashboardSection } from "./section-nav";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./ui/theme-toggle";
import { CreateReportButton } from "./create-report-button";
import type { Capability, Service } from "@/lib/auth";

type Props = {
  /** The currently-active client. Drives the breadcrumb + client logo. */
  client: {
    name: string;
    slug: string;
    brand_logo_url?: string | null;
    brand_accent_color?: string | null;
  };
  /** Optional trailing breadcrumb segment — e.g. "Ads", "Admin". */
  section?: string;
  /**
   * When provided, renders the Home/Ads/Socials link-toggle in the breadcrumb
   * in place of the static `section` label.
   */
  sectionNav?: { slug: string; active: DashboardSection; sections: Capability[] };
  /** Authenticated user info to render in the user menu. */
  user: { email: string };
  /** When provided, renders a client switcher (admin / super_admin only). */
  switcher?: {
    activeSlug: string;
    clients: SwitcherClient[];
  };
  /**
   * When provided, renders a small "Settings" gear link pointing here.
   * Only set this for viewers with /admin write access.
   */
  adminHref?: string;
  /**
   * When provided, renders the "Create Report" button (branded PDF export).
   * `services` is the client's enabled_services — it drives the modal's
   * service checkboxes. Universal across product tabs.
   */
  report?: { clientId: string; services: Service[] };
  /**
   * Optional per-service action bar rendered as a slim SECOND row beneath the
   * main header (kept inside the sticky <header> so both rows pin together).
   * Used by /ads (Real·Projected + Refresh + "Updated") and /socials (Connect
   * Platform). Pages without their own header actions (Home, Web & SEO) omit
   * it, so no empty bar renders.
   */
  subheader?: React.ReactNode;
};

export function DashboardHeader({
  client,
  section,
  sectionNav,
  user,
  switcher,
  adminHref,
  report,
  subheader,
}: Props) {
  return (
    <header className="border-b border-[var(--surface-3)]/60 bg-[var(--surface-0)]/95 backdrop-blur sticky top-0 z-10">
      {/* ── main row: identity + nav (left), universal actions (right) ── */}
      <div className="w-full px-4 md:px-6 lg:px-12 h-16 flex items-center justify-between gap-4 md:gap-6">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          {/* Mobile-only hamburger → drawer (tabs + client switcher). Only when
              there's nav context (every dashboard tab passes sectionNav; the
              desktop-only admin page doesn't, so no hamburger there). */}
          {sectionNav && (
            <MobileNav
              slug={sectionNav.slug}
              active={sectionNav.active}
              sections={sectionNav.sections}
              client={client}
              switcher={switcher}
            />
          )}

          {/* Compact icon mark on mobile (saves width for the section label),
              full wordmark on desktop. */}
          <span className="md:hidden inline-flex">
            <Logo variant="icon" size={26} />
          </span>
          <span className="hidden md:inline-flex">
            <Logo size={28} />
          </span>

          {/* Mobile-only: show which tab you're on (the inline nav is hidden
              <md; the hamburger handles switching). */}
          {section && (
            <>
              <span className="md:hidden text-[var(--text-tertiary)]">/</span>
              <span className="md:hidden text-sm font-medium text-[var(--text-primary)] truncate">
                {section}
              </span>
            </>
          )}

          <span className="text-[var(--text-tertiary)] hidden md:inline">/</span>
          <div className="hidden md:flex items-center">
            <ClientLogo client={client} size={26} />
            {switcher ? (
              <ClientSwitcher
                activeSlug={switcher.activeSlug}
                clients={switcher.clients}
              />
            ) : (
              <span className="text-sm text-[var(--text-primary)] font-medium">
                {client.name}
              </span>
            )}
          </div>

          {sectionNav ? (
            <>
              <span className="text-[var(--text-tertiary)] hidden md:inline">/</span>
              <span className="hidden md:inline">
                <SectionNav
                  slug={sectionNav.slug}
                  active={sectionNav.active}
                  sections={sectionNav.sections}
                />
              </span>
            </>
          ) : section ? (
            <>
              <span className="text-[var(--text-tertiary)] hidden md:inline">/</span>
              <span className="text-sm text-[var(--text-secondary)] hidden md:inline">
                {section}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-3 md:gap-4">
          {/* Report generation is desktop-only — hidden on mobile (the PDF
              export + its modal aren't a mobile task). */}
          {report && (
            <div className="hidden md:block">
              <CreateReportButton
                client={{ id: report.clientId, slug: client.slug, name: client.name }}
                services={report.services}
              />
            </div>
          )}
          {adminHref && (
            <ProgressLink
              href={adminHref}
              className="hidden md:flex h-9 w-9 rounded-md hover:bg-[var(--surface-2)] items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Admin settings"
              title="Admin settings"
            >
              <Settings size={16} />
            </ProgressLink>
          )}
          <ThemeToggle />
          <UserMenu email={user.email} />
        </div>
      </div>

      {/* ── optional per-service action subheader (slim second row) ──
          The ServiceSubheader owns its own full-width layout (status-led
          split bar); this wrapper just provides the secondary-bar surface. */}
      {subheader && (
        <div className="hidden md:block border-t border-[var(--surface-3)]/40 bg-[var(--surface-1)]/40">
          {subheader}
        </div>
      )}
    </header>
  );
}
