# Relay — Security Case Study

An interactive security walkthrough of a **multi-tenant social-media management
platform**, built as a cybersecurity portfolio piece. Relay is a faithful **mock**
of a production SaaS — synthetic data, no real backend, not affiliated with any
employer's production system — rebuilt so every section can explain the engineering
and, above all, the **security** behind it.

The goal: a hiring manager can browse it, click into any section, and — wherever
possible — **try the attack and watch the defense hold**.

## What it demonstrates

- **Multi-tenant isolation with Postgres RLS** — one tenant physically cannot read
  another's rows; the database enforces it.
- **Passwordless auth** — Google OAuth + email magic link, domain + per-email
  allowlists. No password store to leak.
- **OAuth grants, tenant-bound** — connecting Meta / TikTok / YouTube / LinkedIn
  signs the client id into an HMAC'd state (server-only secret, PKCE where
  supported); a forged callback can't repoint a grant.
- **Encrypted token vault** — access/refresh tokens encrypted at rest, never shipped
  to the browser.
- **Secure SDLC with AI** — built fast with AI assistance, then adversarially
  reviewed (multi-agent audit + self-pentest), with CI guards that fail the build on
  a security regression.
- **Hardened & inspectable** — the site itself ships strict security headers and a
  deny-framing policy. Open devtools; the claims are verifiable.

## Interactive demos (in progress)

1. **Vault REVOKE time-machine** — call a secret-decryption RPC as anon; flip the
   grant from drifted to locked and watch the same request go from leaking a token
   to *permission denied*.
2. **Cross-tenant fetch wall** — edit the client id in a request and watch RLS 403 it.
3. **OAuth state-forgery bench** — real in-browser HMAC-SHA256 rejects a tampered /
   replayed state.
4. **Security-headers scanner** — live before/after headers + a clickjacking iframe
   blocked by `frame-ancestors`.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · deployed on Vercel. Synthetic
data; an optional throwaway Supabase project powers the live RLS demo.

## Local development

```bash
npm install
npm run dev   # http://localhost:3000
```

---

Built by Vladimir — cybersecurity-focused engineer (OSCP+, Security+).
