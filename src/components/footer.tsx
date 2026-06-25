/**
 * Global footer — appears on every page (mounted in the root layout).
 *
 * Three things:
 *   1. Relay logo (clickable, links to the marketing site)
 *   2. Inline link list: Support, Terms of Service, Privacy Policy
 *   3. Copyright with the current year
 *
 * Layout:
 *   - Desktop (md+): single row, logo + nav on the left, copyright on
 *     the right.
 *   - Mobile: centred two-row stack —
 *       Row 1: logo · Support · Terms · Privacy
 *       Row 2: © year Relay
 *     Both rows centred and condensed so the footer doesn't read as a
 *     sad left-aligned column.
 *
 * Why this is a server component:
 *   - The links are static and pre-known. No client state, no JS.
 *   - The copyright year is computed at render time on the server using
 *     `new Date().getFullYear()`.
 */
import { Logo } from "./logo";

const SUPPORT_URL = "https://vladimircuc.com";
const MAIN_SITE_URL = "https://vladimircuc.com";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto border-t border-[var(--surface-3)]/40 bg-[var(--surface-0)]">
      <div
        className={
          // Mobile: centred column with two rows. Desktop: left/right
          // split. Same content, different choreography.
          "w-full px-4 md:px-6 lg:px-12 py-5 md:py-6 " +
          "flex flex-col items-center gap-2.5 text-center " +
          "md:flex-row md:items-center md:justify-between md:gap-6 md:text-left " +
          "lg:mx-auto lg:max-w-[90vw]"
        }
      >
        {/* Logo + link list. Stays a single row in both layouts — only
            its alignment relative to the rest of the footer changes. */}
        <div className="flex items-center gap-4 md:gap-6">
          <a
            href={MAIN_SITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center hover:opacity-80 transition-opacity shrink-0"
            aria-label="Relay — open marketing site"
          >
            {/* href={null} — the footer's own <a> is the link here.
                Without this, Logo renders its own <a href="/">, nesting
                anchors and triggering a hydration error. */}
            <Logo variant="full" size={20} href={null} />
          </a>

          {/* Vertical divider visible only on mobile (the logo and the
              link list sit on the same row there). On desktop the
              logo + links read together with their own gap. */}
          <span aria-hidden className="text-[var(--surface-3)] md:hidden">·</span>

          {/* Terms + Privacy point at THIS app's own pages (relative → same
              domain as the page), so the links match the URLs given to
              TikTok/Meta review and ToS is reachable from every page. */}
          <nav className="flex items-center gap-4 text-[12px] text-[var(--text-tertiary)]">
            <FooterLink href={SUPPORT_URL}>Support</FooterLink>
            <FooterLink href="/terms-of-service">Terms</FooterLink>
            <FooterLink href="/privacy-policy">Privacy</FooterLink>
          </nav>
        </div>

        {/* Copyright. Slightly muted, smaller on mobile so the logo row
            stays the dominant element. */}
        <div className="text-[10.5px] md:text-[11px] text-[var(--text-tertiary)] tabular-nums">
          © {year} Relay · All rights reserved
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-[var(--text-primary)] transition-colors"
    >
      {children}
    </a>
  );
}
