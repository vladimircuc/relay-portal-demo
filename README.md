<img src="public/relay-logo.png" alt="Relay" width="56" align="left" />

# Relay — a security-engineering demo

A public, interactive demo of a **multi-tenant marketing-analytics SaaS**, built to make my security work *tangible* — not just "the app works," but a place where you can **play the attacker and watch the defenses stop you, live in your browser.**

**▶ Live app:** https://relay.vladimircuc.com &nbsp;·&nbsp; **🛡 Security Lab:** https://relay.vladimircuc.com/security

> No login required for the Security Lab. To explore the app itself, click **"Continue with Google"** on the login page — it drops you straight in as an admin over synthetic data.

---

## What this is

Relay is a faithful, rebranded copy of a multi-tenant analytics platform I built and shipped to production. It runs on a throwaway database seeded with a **full year of synthetic data**, so anyone can click through the real product — three services (Ads, Social, Web & SEO), client switching, an admin/settings surface — without a single real account, token, or tenant being involved.

It's intentionally **safe to leave open to the public**: every action that would mutate data instead opens a short *"how it works in production"* explainer, and the admin surface is wrapped in a read-only guard. The interesting part is what's underneath — the same row-level-security policies, OAuth state signing, and egress guards that run in the real app.

## Why I built it

I'm targeting **application security / security engineering** roles. A résumé line like *"built a secure multi-tenant SaaS"* is easy to write and impossible to verify, so I made the security something you can actually touch:

- **Build it** — a real, non-trivial product (multi-tenant, OAuth integrations, server-rendered reports).
- **Break it** — the Security Lab lets you trigger real attack patterns and see exactly where they die.
- **Defend it** — every demo maps to a control that's actually implemented in the codebase, explained in plain English *and* at the mechanism level.

The point is to show I can reason about how an app gets attacked and implement — and verify — the controls that stop it.

## 🛡 The Security Lab — three interactive demos

Each demo is one scenario → you trigger the attack → the defense stops it, animated, with a plain-English explainer for non-technical readers and the real mechanism for engineers. **Everything runs client-side on synthetic data.**

### 1. Tenant isolation — Row-Level Security
Signed in as a user for one client, you try to `SELECT` another client's rows. Postgres RLS evaluates `client_id IN (accessible_client_ids())` **inside the database, before any app code runs**, and silently returns `0 rows` (HTTP 200) — not an error, so an attacker can't even confirm the other tenant exists. Flip the toggle to your own client and the same query returns the data. The boundary lives at the data layer, so a bug in the app — or a leaked anon key — can still only read what the user is authorized for.

### 2. OAuth state forgery — HMAC-signed state
Connecting a social account round-trips through OAuth with a signed `state` (`clientId.returnTo.timestamp.hmac`). You play the attacker: tamper the `clientId` to point a grant at another tenant, or replay an expired state. The demo **recomputes the HMAC-SHA256 live in your browser with the Web Crypto API** — same algorithm and verification order as production — and shows the two signatures diverging byte-by-byte → `HTTP 400, bad signature`. A 10-minute TTL and constant-time comparison round it out, so forgery and replay both fail before any token is exchanged.

### 3. SSRF guard — egress filtering
Reports embed a client-supplied logo URL, so the server fetches it. You point it at the cloud-metadata endpoint (`169.254.169.254`), `localhost`, or a private IP. The **same `isBlockedHost()` CIDR logic** (loopback `127/8`, link-local/metadata `169.254/16`, RFC-1918 `10/8` · `172.16/12` · `192.168/16`, http/https-only) runs in the browser and refuses anything pointing inward — the exact class of bug behind the 2019 Capital One breach.

## Security controls implemented in the app

Because the demo is a copy of a production app, these are **real, shipped controls** — not props for the lab:

| Area | Control |
|------|---------|
| **Multi-tenancy** | Postgres Row-Level Security on every table; access derived from an email/domain allowlist via `accessible_client_ids()` |
| **Secrets at rest** | Provider OAuth tokens stored in **Supabase Vault** — only an opaque vault id touches SQL; tokens never reach the browser |
| **OAuth CSRF/forgery** | HMAC-SHA256-signed state, **constant-time** verification, 10-minute TTL, **PKCE** for TikTok, re-checked client authorization before token exchange |
| **SSRF** | Protocol whitelist + private/loopback/link-local/metadata host blocklist on all server-side fetches; session cookie only forwarded same-origin |
| **Injection** | HTML-attribute escaping of client-supplied fields before the headless-Chrome report renderer |
| **Auth secrets** | Constant-time bearer-secret comparison on cron/ETL endpoints; per-client rate limiting |
| **Open redirect** | Allowlist-validated post-login redirect helper |
| **Account hygiene** | Free-email-domain denylist on client-user invites |
| **Least privilege** | Locked-down DB grants (Vault access restricted), enforced by a CI grant-guard |
| **Transport/headers** | Security headers (CSP, etc.) at the edge |

I also ran a **structured security audit** of the app — **1 critical + 11 lower-severity findings** — and remediated and verified every one before shipping the fixes.

## How it was built

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres + Auth + Vault) · Recharts · deployed on Vercel.

**AI-accelerated, human-audited.** I built this with **Claude Code** as a pair-programmer to move quickly — then I treated the result the way I'd treat any code landing in a security review. I ran a full audit on it, hardened the findings, and added **defense-in-depth**: the Security Lab and the demo's inert buttons are the UX layer, but every mutating server action *also* carries a server-side read-only guard, so nothing can be driven from a hand-crafted request either. I verified no secrets are committed and that the privileged keys live only in deploy-time environment variables. The AI accelerated the build; the threat modeling, the audit, and the security decisions are mine — which is exactly the skill this project is meant to demonstrate: taking fast-moving code and holding it to a security standard.

## Safe by design

- **Synthetic data only** — no real users, tenants, tokens, or credentials anywhere.
- The database is a disposable project. The public anon key is public *by design* (RLS is the boundary); privileged keys live only in Vercel env vars and are **never** in this repo (`.env*` is gitignored).
- Every mutating action in the demo is inert — the UI opens an explainer and the server action refuses to write — so the public instance can't be tampered with.

## About

Built by **Vladimir Cuc** — OSCP+ and Security+ certified, focused on application security / security engineering.

🌐 [vladimircuc.com](https://vladimircuc.com)
