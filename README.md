<img src="public/relay-logo.png" alt="Relay" width="56" align="left" />

# Relay

**A real app I built, rigged so you can try to hack it and watch the security stop you.**

Most "I build secure software" claims you just have to take on faith. This one you can test yourself, right now, in your browser.

**Live app:** https://relay.vladimircuc.com
**Go break it:** https://relay.vladimircuc.com/security

No account needed for the security demos. Want to see the actual product? Hit "Continue with Google" on the login page and you're in. All fake data.

## What it is

Relay is a real marketing-analytics SaaS I built and shipped at work. I rebranded it and pointed it at a throwaway database loaded with a year of made-up data, so the whole thing is live and clickable but totally harmless. Three full services (Ads, Social, Web and SEO), client switching, an admin panel, charts everywhere.

Try to change something and you can't. Every save or delete button just opens a popup explaining what it does in the real product and how it's locked down. Nothing on the public version can be touched.

## Why it exists

I want a job in application security, and "I build secure software" is impossible for anyone to verify. So I made the security something you can attack.

The Security Lab drops you into the attacker's seat. You run the moves a real attacker would run, and you watch each one slam into a wall. Every demo is backed by a control that's actually in the code, written in plain English for anyone, with the real mechanism sitting right underneath for the engineers.

## The Security Lab

Three demos. All live, all running in your browser on fake data. Here's what you get to try.

### Read another company's data
The app keeps dozens of businesses in one database. You log in as one company and ask for a different company's records.

You get nothing back. Not an error. Not "access denied." Just an empty result, like the data was never there, so you can't even tell the other company exists. Switch to your own company and the exact same request returns everything.

The rule lives inside the database, underneath the app, so a bug in the code or a stolen key still can't reach what it shouldn't. *(Postgres Row-Level Security.)*

### Forge a login
Connecting a social account hands you a signed ticket on the way out to Facebook, and checks it on the way back. You try to rewrite that ticket to point at someone else's account, or replay an old one.

It doesn't take. The demo runs the real signature check live in your browser with actual cryptography, shows the signature falling apart byte by byte, and throws the whole thing out. You can read the ticket. You can't fake one, because the key that signs it never leaves the server. *(HMAC-signed OAuth state, constant-time check, ten-minute expiry, PKCE on TikTok.)*

### Point the server at itself
Reports load the client's logo from a web address someone typed in, so the server goes and fetches it. You feed it an internal address instead: the cloud's secret-keys endpoint, localhost, a private IP.

A guard inspects the address before anything happens, sees it points inward, and refuses. That exact gap is what leaked over 100 million records in the Capital One breach. *(Protocol allow-list plus a private, loopback, and cloud-metadata block on every server-side fetch.)*

## What's actually protecting it

It's a copy of a production app, so these are real, shipped controls. Not props for the demo.

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

Before shipping, I ran a full security review of the app. One critical, eleven smaller. I fixed and re-checked every one.

## How I built it

Next.js, TypeScript, Tailwind, and Supabase (Postgres, Auth, Vault), running on Vercel.

I used Claude to build it fast, then went through the whole thing the way I'd go through anyone else's code in a review. Ran the audit, fixed the findings, and added a second layer on top: the demo buttons are dead in the browser, but the server refuses those writes too, so you can't sneak around it with a hand-built request. No keys live in the repo.

The AI wrote a lot of the code. The security calls were all mine, and that gap is the whole point of this project. Anyone can generate code fast now. The part that still takes a person is making sure it actually holds up.

## Safe by design

- Fake data only. No real people, companies, or tokens anywhere.
- The database is disposable. The public key is supposed to be public (the database itself is what enforces access), and the real keys live only in the host's settings, never in this repo.
- Nothing in the demo writes, so the public version can't be messed with.

## Me

Vladimir Cuc. OSCP+ and Security+ certified, focused on application security and security engineering.

https://vladimircuc.com
