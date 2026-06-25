import { redirect } from "next/navigation";
import Link from "next/link";
import { Link2, LineChart, LayoutGrid, ShieldCheck, Lock, ArrowRight } from "lucide-react";
import { getCurrentUser, resolveAccess } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/**
 * Root `/` — smart entry point + PUBLIC landing.
 *
 *   - Signed in (super admin / admin) → /clients
 *   - Signed in (client user)         → /{their-slug}/home
 *   - Signed in (no access)           → /no-access
 *   - NOT signed in                   → public landing page (below)
 *
 * Why the landing exists: OAuth platform review (TikTok, Meta) requires the
 * app's website URL to be a real, NON-login page describing the product, on
 * the SAME domain as /terms-of-service, /privacy-policy, and the OAuth
 * redirect. The portal is otherwise login-gated, which review rejects
 * ("website can't be a login page"). This gives anonymous visitors (and
 * reviewers) a public front door while the dashboard itself stays gated —
 * real users just click "Log in".
 *
 * TikTok-review specifics this page is built to satisfy:
 *   - The homepage title + heading display the app name verbatim ("Posted
 *     Social"), matching the app name, domain (posted-social.com), Privacy
 *     Policy, and Terms of Service.
 *   - Terms of Service + Privacy Policy are linked prominently (top nav,
 *     a dedicated trust panel, and the global footer) — "easily accessible
 *     from the homepage."
 *   - The integrations the app uses (incl. TikTok) and the read-only nature
 *     of the access are described so a reviewer sees what the site does.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (user?.email) {
    const access = await resolveAccess(user.email);
    switch (access.kind) {
      case "super_admin":
      case "admin":
        redirect("/clients");
      case "client_user":
        redirect(`/${access.client.slug}/home`);
      case "no_access":
        redirect("/no-access");
    }
  }
  return <Landing />;
}

const PLATFORMS = [
  { name: "Facebook", src: "/brand/social/facebook.png" },
  { name: "Instagram", src: "/brand/social/instagram.png" },
  { name: "YouTube", src: "/brand/social/youtube.png" },
  { name: "TikTok", src: "/brand/social/tiktok.png" },
  { name: "LinkedIn", src: "/brand/social/linkedin.png" },
];

function Landing() {
  return (
    <>
      {/* ── Top nav: logo + legal links + Log in. The Terms/Privacy links
          live here (and in the trust panel + global footer) so the legal
          pages are reachable from the homepage in one click — a TikTok
          review requirement. */}
      <header className="sticky top-0 z-10 border-b border-[var(--surface-3)]/50 bg-[var(--surface-0)]/90 backdrop-blur">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Logo variant="full" size={24} href={null} />
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/terms-of-service"
              className="hidden sm:inline-flex h-9 items-center px-3 rounded-md text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
            >
              Terms of Service
            </Link>
            <Link
              href="/privacy-policy"
              className="hidden sm:inline-flex h-9 items-center px-3 rounded-md text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
            >
              Privacy Policy
            </Link>
            <ThemeToggle />
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-9 px-4 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] text-[13px] font-semibold hover:bg-[var(--ps-yellow-soft)] transition-colors"
            >
              Log in
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        {/* Soft brand glow behind the hero — purely decorative. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 0%, color-mix(in srgb, var(--ps-yellow) 13%, transparent), transparent 72%)",
          }}
        />

        <div className="relative w-full max-w-6xl mx-auto px-5 sm:px-8">
          {/* ── Hero */}
          <section className="pt-16 sm:pt-24 pb-12 flex flex-col items-center text-center gap-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--surface-3)]/60 bg-[var(--surface-1)] px-3 py-1 text-[12px] font-medium text-[var(--text-tertiary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ps-yellow)]" />
              Agency social &amp; ads reporting
            </span>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-[var(--text-primary)]">
              Relay
            </h1>
            <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-2xl">
              One dashboard for marketing agencies to track every client&apos;s
              organic social and paid-ads performance — across Facebook,
              Instagram, YouTube, TikTok, and LinkedIn — in a single unified view.
            </p>
            <div className="flex flex-col items-center gap-3 pt-2">
              <Link
                href="/login"
                className="group inline-flex items-center justify-center gap-2 h-11 px-7 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] text-[14px] font-semibold hover:bg-[var(--ps-yellow-soft)] transition-colors"
              >
                Log in
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <span className="text-[12px] text-[var(--text-tertiary)]">
                Access is for Relay staff and invited client contacts.
              </span>
            </div>
          </section>

          {/* ── Platform strip. Each colorful app-icon tile (TikTok, the IG
              gradient, etc.) sits on a white chip so they read clearly in BOTH
              themes; a theme-aware hairline ring + soft shadow define the chip
              edge against either the dark or the light page. */}
          <section className="pb-14 flex flex-col items-center gap-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Connects with the platforms you already use
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              {PLATFORMS.map((p) => (
                <div
                  key={p.name}
                  title={p.name}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-[var(--surface-3)]/70"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt={p.name} className="h-9 w-9 object-contain" />
                </div>
              ))}
            </div>
          </section>

          {/* ── What it does — three plain-language steps. Gives an OAuth
              reviewer the product context they ask for. */}
          <section className="pb-14 grid sm:grid-cols-3 gap-4">
            <Feature
              icon={<Link2 size={18} />}
              title="Connect an account"
              body="A client authorizes read-only access to their Facebook Page, Instagram, YouTube channel, TikTok account, or LinkedIn page."
            />
            <Feature
              icon={<LineChart size={18} />}
              title="Track performance"
              body="Followers, reach, impressions, engagement, watch time, and per-post stats — pulled daily and stored as history, never modified."
            />
            <Feature
              icon={<LayoutGrid size={18} />}
              title="One unified view"
              body="Every platform's organic metrics side by side, with daily trends and period-over-period change, alongside paid-ads results."
            />
          </section>

          {/* ── Trust / data panel. Doubles as the second prominent home-for
              the legal links and spells out the read-only, scoped nature of
              the integrations (incl. TikTok) for OAuth reviewers. */}
          <section className="pb-20">
            <div className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/50 bg-[var(--surface-1)] p-7 sm:p-9 flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row sm:items-start gap-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--accent-fg)]">
                  <ShieldCheck size={22} />
                </div>
                <div className="flex flex-col gap-2">
                  <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                    Read-only, scoped, and revocable
                  </h2>
                  <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed max-w-3xl">
                    Relay only ever <strong>reads</strong>{" "}analytics on a
                    client&apos;s behalf — we never post, message, or modify
                    anything on a connected account. For TikTok we use the Login
                    Kit and Display API to read the account&apos;s public profile,
                    follower and video stats, and the list of public videos with
                    their view, like, comment, and share counts. Each
                    client&apos;s data is scoped to their own dashboard, access
                    tokens are encrypted at rest, and a client can disconnect or
                    request deletion at any time.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1 border-t border-[var(--surface-3)]/40 sm:pt-5">
                <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
                  <Lock size={13} /> Your data, your control
                </span>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <LegalLink href="/terms-of-service">Terms of Service</LegalLink>
                  <LegalLink href="/privacy-policy">Privacy Policy</LegalLink>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-5 flex flex-col gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--accent-fg)]">
        {icon}
      </div>
      <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{body}</p>
    </div>
  );
}

function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-[var(--surface-3)]/60 bg-[var(--surface-0)] text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--surface-3)] transition-colors"
    >
      {children}
      <ArrowRight size={13} className="opacity-60" />
    </Link>
  );
}
