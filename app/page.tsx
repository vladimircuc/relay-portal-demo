import type { ReactNode } from "react";

const DEMO_REPO = "https://github.com/vladimircuc/relay-portal-demo";

const POSTURE = [
  { k: "RLS", v: "on every tenant table", note: "no always-true policies" },
  { k: "0", v: "secrets in 154 commits", note: "full-history scanned" },
  { k: "Passwordless", v: "magic-link + OAuth", note: "no password store" },
  { k: "AES", v: "tokens encrypted at rest", note: "in a secrets vault" },
];

const PILLARS = [
  {
    title: "Multi-tenant isolation (RLS)",
    body: "Every tenant table is row-level-security'd. A logged-in viewer for one client physically cannot read another's rows — the database filters it, not the app code.",
    tag: "Postgres RLS",
  },
  {
    title: "Passwordless authentication",
    body: "No passwords to leak. Sign-in is Google OAuth or an email magic link; access is granted by company-domain rules and a per-email allowlist.",
    tag: "Supabase Auth",
  },
  {
    title: "OAuth grants, tenant-bound",
    body: "Connecting Meta / TikTok / YouTube / LinkedIn signs the client id into an HMAC'd state with the provider's server-only secret. A forged callback can't repoint a grant at another tenant.",
    tag: "HMAC state · PKCE",
  },
  {
    title: "Encrypted token vault",
    body: "Access + refresh tokens are stored encrypted at rest in a secrets vault and never shipped to the browser — only an opaque vault id touches the database.",
    tag: "Vault · at-rest crypto",
  },
  {
    title: "Secure SDLC with AI",
    body: "Built fast with AI assistance, then adversarially reviewed: a multi-agent audit, a self-pentest, and CI guards that fail the build on a security regression.",
    tag: "AI-accelerated, reviewed",
  },
  {
    title: "Hardened & inspectable",
    body: "The site itself is the proof. Open devtools: strict security headers, a deny-framing policy, no secrets in the bundle. Don't take the claims on faith — verify them.",
    tag: "Headers · CSP",
  },
];

const DEMOS = [
  {
    n: "01",
    title: "Vault REVOKE time-machine",
    body: "Call a secret-decryption RPC as an anonymous user. Flip the grant from “drifted” to “locked” and watch the exact same request go from leaking a token to permission denied.",
    tied: "the one critical the audit found — and fixed",
    wow: "flagship",
  },
  {
    n: "02",
    title: "Cross-tenant fetch wall",
    body: "Signed in as Tenant A, edit the client id in the request to Tenant B and fire it. Watch RLS return 403 — with the decoded token showing why the database refused.",
    tied: "multi-tenant RLS isolation",
    wow: "high",
  },
  {
    n: "03",
    title: "OAuth state-forgery bench",
    body: "Play attacker: tamper the signed state, flip a signature byte, replay an expired one. Real in-browser HMAC-SHA256 rejects each — verify the crypto yourself.",
    tied: "OAuth tenant-binding",
    wow: "high",
  },
  {
    n: "04",
    title: "Security-headers scanner",
    body: "A live before/after of the response headers, plus a clickjacking iframe that loads the page before the fix and is blocked by frame-ancestors after.",
    tied: "headers / CSP",
    wow: "high",
  },
];

export default function Home() {
  return (
    <main id="top" className="flex-1">
      <Nav />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28">
        <p className="kicker">Security case study · built with Claude Code</p>
        <h1 className="mt-5 max-w-4xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl">
          A multi-tenant social platform,{" "}
          <span className="text-accent">rebuilt as a security walkthrough.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-dim">
          Relay is a faithful mock of a production SaaS I built and secured — client
          dashboards, social-platform OAuth, encrypted token vaulting. Every section
          opens up to show the security decisions behind it. Poke at it: the defenses
          are real, and the site itself is hardened to be inspected.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <a
            href="#demos"
            className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-[#06231f] transition hover:opacity-90"
          >
            Explore the demos
          </a>
          <a
            href="#security"
            className="rounded-lg border border-border-2 px-5 py-3 text-sm font-medium text-ink transition hover:bg-surface"
          >
            Read the security story
          </a>
          <span className="ml-1 font-mono text-xs text-faint">
            ↳ open devtools — the headers are part of the demo
          </span>
        </div>
      </section>

      {/* Posture strip */}
      <section className="border-y border-border bg-bg-2/60">
        <div className="mx-auto grid max-w-6xl grid-cols-2 md:grid-cols-4">
          {POSTURE.map((p) => (
            <div key={p.k} className="border-border px-6 py-7 [&:not(:last-child)]:border-r [&:nth-child(-n+2)]:border-b md:[&:nth-child(2)]:border-b-0">
              <div className="text-2xl font-semibold tracking-tight text-accent">{p.k}</div>
              <div className="mt-1 text-sm font-medium text-ink">{p.v}</div>
              <div className="mt-0.5 text-xs text-faint">{p.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* What this is */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 md:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="kicker">What you&apos;re looking at</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">
              A real product, opened up for inspection.
            </h2>
            <p className="mt-5 leading-relaxed text-dim">
              The original is a live multi-tenant dashboard agencies use to report ad
              spend, lead funnels, social growth and SEO to their clients — connected
              to Meta, TikTok, YouTube, LinkedIn and Google. Relay reproduces it with{" "}
              <span className="text-ink">synthetic data and no real backend</span>, so
              every screen can be explored safely and every section can explain the
              engineering and security behind it.
            </p>
            <p className="mt-4 leading-relaxed text-dim">
              I&apos;m a cybersecurity-focused engineer (OSCP+, Security+). This piece is
              here to <span className="text-ink">show the security work</span>, not just
              claim it — so wherever I can, you get to try the attack and watch the
              defense hold.
            </p>
          </div>
          <ul className="grid content-start gap-3">
            {[
              ["Click any section", "Each part of the dashboard expands into a card explaining what it does and how it's secured."],
              ["Try the attacks", "The interactive demos let you attempt a cross-tenant read, forge an OAuth state, or call a locked RPC — and watch them fail."],
              ["Inspect the site", "Headers, framing policy, bundle — it's all live. The security claims are verifiable, not decorative."],
              ["Everything is fake", "Synthetic data, no real connections, not affiliated with any employer's production system."],
            ].map(([t, b]) => (
              <li key={t} className="card card-hover p-5">
                <div className="text-sm font-semibold text-ink">{t}</div>
                <div className="mt-1.5 text-sm leading-relaxed text-dim">{b}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Security pillars */}
      <section id="security" className="border-t border-border bg-bg-2/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="kicker">The security model</p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight">
            Six things this app gets right.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <article key={p.title} className="card card-hover flex flex-col p-6">
                <span className="self-start rounded-full border border-border-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
                  {p.tag}
                </span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-dim">{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Found & fixed — the honest centerpiece */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="card overflow-hidden">
          <div className="grid md:grid-cols-[1fr_1.15fr]">
            <div className="border-b border-border p-8 md:border-b-0 md:border-r">
              <span className="inline-flex items-center gap-2 rounded-full border border-crit/40 bg-crit/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-crit">
                ● critical · found &amp; fixed
              </span>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight">
                I audited my own app and found a real one.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-dim">
                A multi-agent security audit of the production codebase surfaced a live
                issue: three secret-decryption functions had drifted to being callable
                by anonymous users — exposing every tenant&apos;s OAuth tokens to anyone
                holding the public key.
              </p>
            </div>
            <div className="p-8">
              <ol className="grid gap-4">
                {[
                  ["Caught it", "Adversarial audit + a self-pentest leveraging my OSCP — not a checklist scan."],
                  ["Fixed it", "Restored least-privilege (service-role only), the right way — no guard that would break the legitimate ETL caller."],
                  ["Prevented recurrence", "Added a CI guard that fails the build if any privileged function is ever exposed to anonymous users again."],
                ].map(([t, b], i) => (
                  <li key={t} className="flex gap-4">
                    <span className="mt-0.5 font-mono text-sm text-accent">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-ink">{t}</div>
                      <div className="mt-1 text-sm leading-relaxed text-dim">{b}</div>
                    </div>
                  </li>
                ))}
              </ol>
              <a href="#demos" className="mt-6 inline-block font-mono text-xs text-accent hover:underline">
                ↳ replay the whole thing in the Vault REVOKE time-machine
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Demos */}
      <section id="demos" className="border-t border-border bg-bg-2/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="kicker">Interactive demos</p>
          <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight">
            Try the attack. Watch the defense hold.
          </h2>
          <p className="mt-4 max-w-2xl text-dim">
            These let you verify the security yourself, in the browser — the strongest
            signal there is. Building them out now.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {DEMOS.map((d) => (
              <article key={d.n} className="card card-hover flex flex-col p-6">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-faint">{d.n}</span>
                  <span className="rounded-full border border-border-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-dim">
                    {d.wow === "flagship" ? "★ flagship" : d.wow}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold tracking-tight">{d.title}</h3>
                <p className="mt-2.5 flex-1 text-sm leading-relaxed text-dim">{d.body}</p>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-accent">
                  demonstrates · {d.tied}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="flex items-center gap-2.5">
          <Mark />
          <span className="text-sm font-semibold tracking-tight">Relay</span>
        </a>
        <nav className="flex items-center gap-6 text-sm text-dim">
          <a href="#security" className="hidden hover:text-ink sm:inline">Security</a>
          <a href="#demos" className="hidden hover:text-ink sm:inline">Demos</a>
          <a
            href={DEMO_REPO}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border-2 px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface"
          >
            GitHub ↗
          </a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-faint md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <Mark />
          <span>
            Relay — a security portfolio demo by{" "}
            <a href={DEMO_REPO} target="_blank" rel="noreferrer" className="text-dim hover:text-ink">
              Vladimir
            </a>
            .
          </span>
        </div>
        <p className="max-w-md md:text-right">
          Synthetic data. No real platform connections. Not affiliated with any
          employer&apos;s production system.
        </p>
      </div>
    </footer>
  );
}

function Mark(): ReactNode {
  return (
    <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/15 ring-1 ring-accent/30">
      <span className="h-2 w-2 rounded-full bg-accent" />
    </span>
  );
}
