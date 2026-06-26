<div align="center">

<img src="public/relay-logo.png" alt="Relay" width="88" />

# Relay

**A full marketing-analytics platform, built with AI in a fraction of the usual time,**
**then hardened until it could take a real beating. It's live, and you're invited to attack it.**

**👇 Both buttons below are clickable. Start with the live app, then come break it in the Lab.**

[![Open the live app](https://img.shields.io/badge/Open_the_live_app-relay.vladimircuc.com-ff6a00?style=for-the-badge)](https://relay.vladimircuc.com)
&nbsp;&nbsp;
[![Security Lab](https://img.shields.io/badge/Security_Lab-attack_it-ff3d2e?style=for-the-badge)](https://relay.vladimircuc.com/security)

<br>

![Next.js](https://img.shields.io/badge/Next.js-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)

</div>

## Why I built it

I'm into security, and I wanted to see how far AI-assisted development could actually go. Could you build something this big this fast and still have it hold up when someone comes at it?

Turns out yes, as long as you treat security as its own job instead of an afterthought. **This is me proving that to myself.**

It's a copy of a real product I shipped, rebranded and pointed at a database full of fake data, so the whole thing runs for real but can't hurt anyone.

## What it actually does

Relay is the dashboard a marketing agency lives in to keep tabs on every client at once. It pulls three completely different worlds of data into one place and makes them line up.

### 📈 Paid ads
Meta ad spend and a CRM, stitched into one funnel.
- **Money in, revenue out,** with return on ad spend front and center
- **Leads by source,** broken out at a glance
- **The full pipeline,** first lead to closed deal
- **Projection mode** that forecasts where the month lands
- **Any date range** recomputes the whole page

### 📱 Organic social
Five platforms in one view: Facebook, Instagram, TikTok, YouTube, LinkedIn.
- **Followers, reach, impressions, engagement,** per platform or stacked together
- **Top posts** and a heatmap of when posting actually performs
- **A connect flow** that walks a client through authorizing each account

### 🔎 Web and SEO
Search Console and GA4, side by side.
- **Clicks, impressions, position, keywords, sessions, conversions,** all of it
- **A live local-rank map** showing where a business lands across a grid of points on the map
- **The competitors** beating them, and the whole trend over twelve months

### Under the hood

The dashboards are the easy part to see. Most of the work is everything feeding them:

```
Meta Ads ─┐
CRM ──────┤
Socials ──┼──▶  nightly ETL  ──▶  Postgres (a year of history)  ──▶  dashboards + PDF reports
SEO ──────┘
```

- **OAuth connect flows** for every platform, each quirk handled (Meta's page picker, TikTok's PKCE, Google's channel selector)
- **PDF reports** rendered by a headless browser, branded per client
- **A real admin surface:** role-based access with scoped permissions, per-client credentials, pipeline mapping, funnel tuning, and a delete that makes you type the name to confirm
- **Multi-tenant from the ground up,** so one agency's clients can never see another's

## 🛡️ The Security Lab

Three demos, all live, all running in your browser on fake data. You're the attacker. Each one is a real attack pattern, and each one runs face-first into a defense that's actually in the code.

| The attack | What you do | What stops it |
|---|---|---|
| **Cross-tenant read** | Ask for another company's data | Postgres Row-Level Security |
| **Login forgery** | Tamper with or replay a signed OAuth ticket | HMAC state, verified live in your browser |
| **SSRF** | Point the server at its own internals | Egress guard on every fetch |

<details>
<summary><b>🔓 Read another company's data</b></summary>
<br>

The app keeps dozens of businesses in one database. You log in as one company and ask for a different company's records.

You get nothing back. Not an error. Not "access denied." Just an empty result, like the data was never there, so you can't even tell the other company exists. Switch to your own company and the same request hands you everything.

The rule lives inside the database, underneath the app, so a bug in the code or a stolen key still can't reach what it shouldn't.

`Postgres Row-Level Security`
</details>

<details>
<summary><b>🪪 Forge a login</b></summary>
<br>

Connecting a social account hands you a signed ticket on the way out to Facebook, and checks it on the way back. You try to rewrite that ticket to point at someone else's account, or replay an old one.

It doesn't take. The demo runs the real signature check live in your browser with actual cryptography, shows the signature falling apart byte by byte, and throws the whole thing out. You can read the ticket. You can't fake one, because the key that signs it never leaves the server.

`HMAC-signed OAuth state` · `constant-time check` · `ten-minute expiry` · `PKCE on TikTok`
</details>

<details>
<summary><b>🌐 Point the server at itself</b></summary>
<br>

Reports load the client's logo from a web address someone typed in, so the server goes and fetches it. You feed it an internal address instead: the cloud's secret-keys endpoint, localhost, a private IP.

A guard inspects the address before anything happens, sees it points inward, and refuses. That exact gap is what leaked over 100 million records in the Capital One breach.

`protocol allow-list` · `private, loopback, and cloud-metadata block on every fetch`
</details>

## What's actually protecting it

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

> [!NOTE]
> I didn't just hope it was secure. I ran the whole thing through security audits, found **one critical issue and eleven smaller ones,** and fixed and re-checked every one. The lab demos are those exact controls, confirmed working, that you get to test for yourself.

## ⚡ The AI part, since it comes up

I built this with Claude, and I built it fast. Work that would normally eat weeks came together in a tiny slice of that.

The point I care about isn't that AI wrote a lot of the code. It's that the result is genuinely secure. People assume AI-built means sloppy and full of holes, and it can be, if you let the model run loose and trust whatever it hands back. So I didn't. I steered it like an engineer and put the output through real security audits, the same way you'd audit any code before it ships.

> **Used right, AI isn't a liability. It can move incredibly fast and still stand up to attack.** Relay is the proof I wanted.

## Safe by design

> [!IMPORTANT]
> Everything runs on fake data, with no real people, companies, or tokens anywhere. The database is disposable, the public key is public on purpose (the database itself is what enforces access), and the real keys live only in the host's settings, never in this repo. Nothing in the demo writes, so the public version can't be tampered with.

---

<div align="center">

**Vladimir Cuc** &nbsp;·&nbsp; OSCP+ and Security+ certified

I build things like this because breaking and defending software is the most fun I have.

[vladimircuc.com](https://vladimircuc.com)

</div>
