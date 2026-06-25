import Link from "next/link";
import { Database, KeyRound, Globe, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DemoSection } from "@/components/security/demo-section";
import { TenantIsolationDemo } from "@/components/security/tenant-isolation-demo";
import { OAuthForgeryDemo } from "@/components/security/oauth-forgery-demo";
import { SsrfGuardDemo } from "@/components/security/ssrf-guard-demo";

export const metadata = {
  title: "Security Lab — Relay",
  description:
    "Interactive demos of how Relay defends itself: row-level-security tenant isolation, HMAC-signed OAuth state, and an SSRF egress guard.",
};

/**
 * Public Security Lab (/security) — the portfolio centerpiece. Three hands-on
 * attack/defense demos, each faithful to how the real app implements the
 * protection, running entirely client-side on synthetic data. Allowlisted in
 * proxy.ts so it's shareable without a login.
 */
export default function SecurityPage() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-[var(--surface-3)]/50 bg-[var(--surface-0)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <Logo variant="full" size={24} href="/" />
          <nav className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className="inline-flex h-9 items-center rounded-md bg-[var(--ps-yellow)] px-4 text-[13px] font-semibold text-[var(--text-on-yellow)] transition-[filter] hover:brightness-95"
            >
              Open the app
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative">
        {/* Brand glow behind the hero */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[360px]"
          style={{
            background:
              "radial-gradient(58% 100% at 50% 0%, color-mix(in srgb, var(--ps-yellow) 12%, transparent), transparent 72%)",
          }}
        />

        <div className="relative mx-auto w-full max-w-5xl px-5 pb-20 sm:px-8">
          {/* Hero */}
          <section className="flex flex-col items-center gap-4 pt-16 pb-12 text-center sm:pt-20">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--surface-3)]/60 bg-[var(--surface-1)] px-3 py-1 text-[12px] font-medium text-[var(--text-tertiary)]">
              <ShieldCheck size={13} className="text-[var(--accent-fg)]" />
              Security Lab
            </span>
            <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl md:text-5xl">
              Watch the defenses work
            </h1>
            <p className="max-w-xl text-[15px] leading-relaxed text-[var(--text-secondary)]">
              Three hands-on demos. Each one lets you play the attacker, then shows
              exactly how Relay stops it — using the same checks that run in the real
              product. Everything here runs live in your browser on synthetic data.
            </p>
          </section>

          {/* Demos */}
          <div className="flex flex-col gap-7">
            <DemoSection
              n={1}
              Icon={Database}
              title="Tenant isolation"
              scenario="Relay is multi-tenant. Signed in for one client, try to read another client's rows — Postgres Row-Level Security decides what actually comes back."
              plain={{
                gist: "Relay keeps every client's data in one shared database — like one apartment building full of tenants. Each client must only ever see their own rows.",
                youTry: "log in as someone at Brightside Dental, then ask the database for a different company's (Apex Law's) records.",
                blocked: "the database itself refuses and hands back nothing at all — not even an error — so an attacker can't even tell the other company exists.",
              }}
              takeaway="Tenancy is enforced by an RLS policy in the database — client_id IN (accessible_client_ids()) — so it runs before any application code. A cross-tenant read isn't an error, it's silently zero rows, and even a leaked anon key can only read what the signed-in user is allowed to."
            >
              <TenantIsolationDemo />
            </DemoSection>

            <DemoSection
              n={2}
              Icon={KeyRound}
              title="OAuth state forgery"
              scenario="Connecting a social account round-trips through OAuth. The state is signed so an attacker can't forge a callback that repoints a grant — or links their own account — to someone else's dashboard."
              plain={{
                gist: "Connecting a social account is like a coat check: Relay hands you a ticket on the way out to Facebook and checks it on the way back. The ticket carries a wax-seal signature only Relay's server can make.",
                youTry: "grab a real ticket and change which client it's for — but you can't re-create the seal without the server's secret.",
                blocked: "Relay re-checks the seal against your tampered ticket, sees it no longer matches, and rejects it before anything gets connected.",
              }}
              takeaway="The state is HMAC-SHA256 signed with a server-only secret and verified in constant time, behind a 10-minute TTL. Tamper one byte of the payload and the recomputed signature no longer matches; forgery and replay both fail before any token is exchanged."
            >
              <OAuthForgeryDemo />
            </DemoSection>

            <DemoSection
              n={3}
              Icon={Globe}
              title="SSRF guard"
              scenario="Reports embed the client's logo from a client-supplied URL. Point it at an internal address and the egress guard has to stop the server from ever fetching it."
              plain={{
                gist: "Reports show the client's logo from a URL someone typed in, so Relay's server goes and fetches it. But the server sits inside the private network and can reach things outsiders can't — including the cloud's secret-keys service (the mistake behind the Capital One breach).",
                youTry: "set the logo URL to an internal address (like the cloud-metadata server) to make Relay's server fetch something it shouldn't.",
                blocked: "a guard checks the address first and refuses anything pointing inward, so the server never touches internal secrets.",
              }}
              takeaway="Before fetching, the guard enforces an http/https whitelist and blocks loopback, link-local / cloud-metadata, and private IP ranges — and only forwards the session cookie to our own origin. The headless renderer can't be turned into a window into internal infrastructure."
            >
              <SsrfGuardDemo />
            </DemoSection>
          </div>

          {/* Footer note */}
          <footer className="mt-12 flex flex-col items-center gap-2 border-t border-[var(--surface-3)]/40 pt-8 text-center">
            <p className="max-w-lg text-[12.5px] leading-relaxed text-[var(--text-tertiary)]">
              Every check above runs live in your browser on synthetic data — no real
              accounts, tokens, or tenants are involved. The production implementations
              live in the app&apos;s source.
            </p>
            <a
              href="https://vladimircuc.com"
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              vladimircuc.com
            </a>
          </footer>
        </div>
      </main>
    </>
  );
}
