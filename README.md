<img src="public/relay-logo.png" alt="Relay" width="56" align="left" />

# Relay

A live demo of an app I built, set up so you can try to break the security yourself and watch it stop you.

**See it live:** https://relay.vladimircuc.com
**Security demos:** https://relay.vladimircuc.com/security

You don't need an account for the security demos. If you want to look around the actual app, click "Continue with Google" on the login page and it logs you straight in with fake data.

## What it is

This is a copy of a real marketing-analytics product I built and shipped at work. I rebranded it to "Relay" and pointed it at a throwaway database full of a year's worth of made-up data, so it's safe to put online for anyone to click through. You get the real thing: three services (Ads, Social, Web and SEO), switching between clients, an admin area, the charts, all of it.

Nothing here can be changed, though. Any button that would normally save or delete something just opens a small popup that explains what it does in the real product and how it's kept secure. So the public version is impossible to mess up.

## Why I made it

I'm looking for work in application security and security engineering. Writing "I built a secure app" on a resume doesn't really prove anything, so I wanted to make the security something you can see for yourself.

That's what the Security Lab is for. You get to play the attacker. You try the kind of thing a real attacker would try, and you watch where it gets blocked. Each demo lines up with a protection that's in the actual code, and each one is explained in plain words first, with the technical detail underneath if you want it.

## The security demos

There are three of them, and they all run right in your browser on fake data.

**1. Keeping each client's data separate**
The app holds a lot of different businesses' data in one database. You log in as someone from one company, then try to pull up a different company's records. The database itself says no and hands back nothing, not even an error, so you can't even tell whether that other company exists. Switch back to your own company and the same request works fine. The rule that keeps everyone's data private lives down in the database, underneath the app, so even a bug in the code or a stolen key can't get around it.

**2. Faking the login handoff**
When you connect a social account, the app gives you a kind of signed ticket on the way out and checks it on the way back. You play the attacker and try to change who the ticket is for, or reuse an old one. The demo re-does the actual math right there in your browser (real cryptography, not a stand-in), shows the signature no longer lining up, and rejects it. An attacker can read the ticket but can't forge a new one, because the key used to sign it only ever lives on the server.

**3. Tricking the server into fetching the wrong thing**
Reports show the client's logo, which gets loaded from a web address someone typed in, so the server goes and fetches that address. You try pointing it at internal things the server should never reach, like the cloud provider's secret-keys service. A check runs first, spots that the address is internal, and refuses to fetch it. This is the same mistake behind the Capital One breach in 2019, so it matters a lot.

## What actually protects the real app

Since this is a copy of a real product, these are protections that already ship with it, not things I bolted on for the demo:

- One client can never read another client's data, enforced by the database itself
- Access tokens are encrypted in a vault, never stored as plain text and never sent to the browser
- The login handoff is signed, expires after ten minutes, is checked in constant time, and uses PKCE on TikTok
- Server-side fetches are blocked from reaching internal or cloud-metadata addresses
- Anything a user typed is escaped before it goes into a generated PDF
- The background jobs check their secrets in constant time and are rate limited
- The login flow can only redirect you to approved pages, never an attacker's site
- Free email domains are blocked when inviting client users
- Database permissions are locked down, and a CI check fails the build if that ever slips
- Security headers are set at the edge

Before I shipped, I also ran a full security review of the app. It found one critical issue and eleven smaller ones, and I fixed and re-checked every single one.

## How I built it

The stack is Next.js, TypeScript, Tailwind, and Supabase (Postgres, Auth, and Vault), hosted on Vercel.

I built it with Claude, the AI coding tool, so I could move fast. Then I went back over all of it the way I'd review anyone else's code for security. I ran the review I mentioned above, fixed what it turned up, and added a second layer on top. The demo buttons do nothing in the browser, but the server also refuses to make those changes, so you can't get around it by sending a request by hand either. I made sure no keys or secrets ended up in the repo. The AI helped me write the code quickly, but the security calls were mine. That's really the point of this whole thing. Code gets written fast these days, and the part that still takes a human is making sure it actually holds up.

## A note on safety

- Everything runs on fake data. No real people, companies, or accounts are involved.
- The database is a disposable one. The public key is supposed to be public (the real protection is the data separation in the database), and the sensitive keys only live in the host's settings, never in this repo.
- You can't change anything in the demo, so the public version can't be tampered with.

## About me

I'm Vladimir Cuc. I'm OSCP+ and Security+ certified, and I'm focused on application security and security engineering.

Site: https://vladimircuc.com
