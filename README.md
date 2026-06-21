# Relay

**An interactive, navigable mock of a multi-tenant marketing-analytics dashboard —
built as a cybersecurity portfolio piece.**

Relay is a faithful clone of a production SaaS I built and secured: a platform
agencies use to report ad spend, lead funnels, social growth and SEO to their
clients, connected to Meta, TikTok, YouTube, LinkedIn and Google. This version runs
on **synthetic data with no real backend** — so you can click through the whole
product safely, and every place there *was* real functionality explains how it was
actually built and secured.

> Synthetic data. No real platform connections. Not affiliated with any employer's
> production system.

## How to explore it

- **Log in** — the buttons just drop you in (no real auth here). An ⓘ explains the
  real passwordless flow.
- **Pick a client** — the super-admin view lists every tenant.
- **Use the dashboard** — Overview, Paid Ads, Social, Connect, Security Lab.
- **Look for the ⓘ "How I built this" buttons** — on the data pipeline, the OAuth
  connect flow, the report builder, token storage and access control. Each one is a
  short note on the real production implementation + the security around it.
- **Open the Security Lab** — hands-on demos where you run an attack and watch the
  defense hold.

## The security story

The product is genuinely multi-tenant and security-sensitive (it holds OAuth tokens
for every client). The real build emphasizes:

- **Multi-tenant isolation with Postgres RLS** — a tenant physically cannot read
  another's rows; the database filters them, not the app.
- **Passwordless auth** — Google OAuth + email magic link, access by company-domain
  rules and a per-email allowlist, identity always re-derived from a server-validated
  session.
- **OAuth grants bound to a tenant** — the `state` is HMAC-signed with a server-only
  secret and carries the client id (PKCE where supported), so a forged or replayed
  callback can't repoint a grant. Tokens are stored **encrypted in a vault**, never
  shipped to the browser.
- **Defense in depth** — constant-time secret comparison, SSRF-guarded server-side
  fetches, attribute-context output escaping, strict security headers.

It also includes an honest centerpiece: **a real audit of the production codebase
found a critical issue** — three `SECURITY DEFINER` secret-decryption functions had
drifted to being callable by anonymous users, exposing every tenant's OAuth tokens.
I fixed it (restored least-privilege the correct way) and added a **CI guard** that
fails the build if any privileged function is ever exposed to anon/authenticated
again. The **Vault REVOKE time-machine** demo lets you replay it.

## Interactive demos (Security Lab)

- **Vault REVOKE time-machine** ✅ — call the decryption RPC as anon, flip the grant
  drifted → locked, watch it go from leaking a token to `42501 permission denied`.
- **Cross-tenant fetch wall** ✅ — change the `client_id` in a request and watch RLS
  return an empty set for a tenant your token can't access.
- **OAuth state-forgery bench** ⏳ — real in-browser HMAC-SHA256 rejecting a tampered
  or replayed state.
- **Security-headers scanner** ⏳ — live before/after headers + a clickjacking iframe
  blocked by `frame-ancestors`.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · deployed on Vercel. Dependency-
free SVG charts. The interactive demos use in-browser logic; an optional throwaway
Supabase project can later back the RLS demo with a real database.

## Local development

```bash
npm install
npm run dev   # http://localhost:3000
```

---

Built by Vladimir — cybersecurity-focused engineer (OSCP+, Security+).
