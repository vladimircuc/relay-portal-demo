<img src="public/relay-logo.png" alt="Relay" width="56" align="left" />

# Relay

**A full marketing-analytics platform, built with AI in a fraction of the usual time, then hardened until it could take a real beating. It's live, and you're invited to attack it.**

You don't have to believe any of that. Click around the real thing, then head to the lab and try to break it yourself.

**Live app:** https://relay.vladimircuc.com
**Go break it:** https://relay.vladimircuc.com/security

No account needed for the security lab. To roam the actual product, hit "Continue with Google" on the login page and you're in. All fake data.

## Why I built it

I'm into security, and I wanted to see how far AI-assisted development could actually go. Could you build something this big this fast and still have it hold up when someone comes at it? Turns out yes, as long as you treat security as its own job instead of an afterthought. This is me proving that to myself.

It's also a real product, not a toy. It's a copy of something I shipped, rebranded and pointed at a database full of fake data, so the whole thing runs for real but can't hurt anyone.

## What it actually is

Relay is the kind of dashboard a marketing agency lives in to keep tabs on every client at once. It pulls three completely different worlds of data into one place and makes them line up.

### Paid ads
Meta ad spend wired together with a CRM into a single funnel. Money in, revenue out, return on ad spend sitting right at the top. There's a leads-by-source breakdown, a full pipeline from first lead to closed deal, and a projection mode that forecasts where the month is going to land. Pick any date range and the whole page recomputes around it.

### Organic social
Five platforms in one view: Facebook, Instagram, TikTok, YouTube, and LinkedIn. Followers, reach, impressions, engagement, profile visits, the works, sliced per platform or stacked together. Top posts, a heatmap of when posting actually performs, and a connect flow that walks a client through authorizing each account.

### Web and SEO
Search Console and GA4 sitting side by side: clicks, impressions, click-through rate, average position, keywords, sessions, conversions, traffic sources. On top of that, a live local-rank map that shows where a business really lands across a grid of points on the map, which competitors are beating it, and how the whole picture has moved over twelve months.

### Under the hood
The dashboards are the easy part to see. Most of the work is everything feeding them:

- A nightly pipeline that pulls from Meta, the CRM, all five social platforms, and three SEO sources, cleans it all up, and stores it as history
- OAuth connect flows for every platform, each with its own headaches handled (Meta's page picker, TikTok's PKCE, Google's channel selector)
- PDF reports rendered by a headless browser and branded per client
- A real admin surface: role-based access with scoped permissions, per-client credentials, CRM pipeline mapping, funnel tuning, and a client lifecycle that makes you type the name to confirm a delete
- Multi-tenant from the ground up, so one agency's clients can never see another's

The stack is Next.js, TypeScript, Tailwind, and Supabase (Postgres, Auth, and Vault), running on Vercel.

## The Security Lab

This is the part I'd click first. Three demos, all live, all running in your browser on fake data. You're the attacker. Each one is a real attack, and each one runs face-first into a defense that's actually in the code.

### Read another company's data
The app keeps dozens of businesses in one database. You log in as one company and ask for a different company's records.

You get nothing back. Not an error. Not "access denied." Just an empty result, like the data was never there, so you can't even tell the other company exists. Switch to your own company and the exact same request hands you everything.

The rule lives inside the database, underneath the app, so a bug in the code or a stolen key still can't reach what it shouldn't. *(Postgres Row-Level Security.)*

### Forge a login
Connecting a social account hands you a signed ticket on the way out to Facebook, and checks it on the way back. You try to rewrite that ticket to point at someone else's account, or replay an old one.

It doesn't take. The demo runs the real signature check live in your browser with actual cryptography, shows the signature falling apart byte by byte, and throws the whole thing out. You can read the ticket. You can't fake one, because the key that signs it never leaves the server. *(HMAC-signed OAuth state, constant-time check, ten-minute expiry, PKCE on TikTok.)*

### Point the server at itself
Reports load the client's logo from a web address someone typed in, so the server goes and fetches it. You feed it an internal address instead: the cloud's secret-keys endpoint, localhost, a private IP.

A guard inspects the address before anything happens, sees it points inward, and refuses. That exact gap is what leaked over 100 million records in the Capital One breach. *(Protocol allow-list plus a private, loopback, and cloud-metadata block on every server-side fetch.)*

## What's holding it together

It's a copy of a production app, so these are real, shipped controls. Not staged for the lab.

| Area | What's in place |
|------|------|
| **Tenant isolation** | Row-Level Security on every table, enforced by Postgres before any app code runs |
| **Token storage** | OAuth tokens encrypted in a vault, never in plain SQL, never sent to the browser |
| **OAuth safety** | Signed state, constant-time verify, ten-minute expiry, PKCE on TikTok |
| **SSRF** | Private, loopback, and cloud-metadata addresses blocked on every server-side fetch |
| **Injection** | Anything a user typed is escaped before it reaches the PDF renderer |
| **Job secrets** | Constant-time secret checks and rate limiting on the background jobs |
| **Open redirect** | Post-login redirects restricted to approved pages only |
| **Account hygiene** | Free email domains blocked when inviting client users |
| **Least privilege** | Locked-down database grants, with a CI check that fails the build if they ever slip |
| **Edge** | Security headers set in front of the whole app |

I didn't just hope it was secure. I ran the whole thing through security audits, found one critical issue and eleven smaller ones, and fixed and re-checked every one. The lab demos are those controls, confirmed working, that you get to test for yourself.

## The AI part, since it comes up

I built this with Claude, and I built it fast. Work that would normally eat weeks came together in a tiny slice of that.

The point I care about isn't that AI wrote a lot of the code. It's that the result is genuinely secure. People assume AI-built means sloppy and full of holes, and it can be, if you let the model run loose and trust whatever it hands back. So I didn't. I steered it like an engineer and then put the output through real security audits, the same way you'd audit any code before it ships. Used like that, AI doesn't have to be a liability. It can move incredibly fast and still stand up to attack. Relay is the proof I wanted.

## Safe by design

- Fake data only. No real people, companies, or tokens anywhere.
- The database is disposable. The public key is supposed to be public (the database itself is what enforces access), and the real keys live only in the host's settings, never in this repo.
- Nothing in the demo writes, so the public version can't be messed with.

## Me

Vladimir Cuc. OSCP+ and Security+ certified. I build things like this because breaking and defending software is genuinely the most fun I have.

https://vladimircuc.com
