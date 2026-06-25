/**
 * Public Privacy Policy page.
 *
 * Lives at vladimircuc.com/privacy-policy. Must stay public (no
 * auth) because OAuth platform reviewers fetch this URL to verify it exists
 * before approving the app — they're not signed-in users. The path matches
 * TikTok's required convention verbatim (<domain>/privacy-policy).
 *
 * Authoring notes:
 *   - Relay is a B2B agency dashboard. Most of what we collect
 *     is OAuth tokens for clients' marketing accounts, not personal
 *     end-user data. The policy reflects that reality — short, honest,
 *     scoped to what we actually do.
 *   - Treat this as a starting point. If you eventually go through Meta /
 *     Google sensitive-scope review, their lawyers may want specific
 *     clauses added. Update freely.
 *   - The TikTok / Meta / Google site-verification meta tag goes in
 *     `metadata.other` below — set the env var to flip it on without
 *     touching code.
 */
import type { Metadata } from "next";
import { FixedThemeToggle } from "@/components/ui/theme-toggle";

// Platform site-verification meta tags. Each platform may demand its own
// tag (TikTok issues a `tiktok-developers-site-verification` meta tag,
// Google uses `google-site-verification`, Meta uses `facebook-domain-
// verification`). Setting these env vars adds the matching meta tag to
// the page <head> so the OAuth platforms can verify domain ownership.
function siteVerificationTags(): Record<string, string> {
  const out: Record<string, string> = {};
  if (process.env.TIKTOK_VERIFICATION_CODE) {
    out["tiktok-developers-site-verification"] = process.env.TIKTOK_VERIFICATION_CODE;
  }
  if (process.env.GOOGLE_VERIFICATION_CODE) {
    out["google-site-verification"] = process.env.GOOGLE_VERIFICATION_CODE;
  }
  if (process.env.META_DOMAIN_VERIFICATION) {
    out["facebook-domain-verification"] = process.env.META_DOMAIN_VERIFICATION;
  }
  return out;
}

export const metadata: Metadata = {
  // Title leads with the app name verbatim ("Relay Privacy Policy") —
  // TikTok app review requires the privacy page title to display the app name.
  title: "Relay Privacy Policy",
  description:
    "How Relay handles data on behalf of clients using our agency reporting dashboard.",
  other: siteVerificationTags(),
};

const LAST_UPDATED = "June 8, 2026";

export default function PrivacyPage() {
  return (
    <main className="w-full max-w-3xl mx-auto px-6 py-16 flex flex-col gap-6">
      <FixedThemeToggle />
      <header className="flex flex-col gap-2 border-b border-[var(--surface-3)]/40 pb-6">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">Relay Privacy Policy</h1>
        <p className="text-sm text-[var(--text-secondary)]">Last updated: {LAST_UPDATED}</p>
      </header>

      <Section title="Who we are">
        <p>
          Relay is a marketing agency that runs paid advertising and
          social-media-management for client businesses. We operate a private
          internal dashboard at <code>vladimircuc.com</code> that
          agency staff and our individual clients sign into to review their
          campaign performance. This policy covers how we handle data inside
          that dashboard.
        </p>
      </Section>

      <Section title="What data we collect">
        <p>
          <strong>From people who sign into the dashboard</strong> (agency
          staff + designated client contacts): your email address and the
          authentication session managed by Supabase. We do not collect
          passwords directly — sign-in is via Google OAuth or one-time
          email magic links.
        </p>
        <p>
          <strong>From clients&apos; advertising and social-media accounts</strong>{" "}
          (with the client&apos;s explicit OAuth grant): performance metrics
          (impressions, clicks, spend, engagement, follower counts, post
          analytics) and the minimum identifiers needed to fetch those
          metrics on the client&apos;s behalf — Facebook Page ID, Instagram
          Business Account ID, YouTube channel ID, TikTok user ID, LinkedIn
          organization URN, GoHighLevel pipeline IDs.
        </p>
        <p>
          <strong>What we do not collect:</strong> the content of private
          messages or DMs, individual end-user profiles or audience PII
          beyond aggregate demographics, payment information, or anything
          unrelated to the advertising / social-media services we provide.
        </p>
      </Section>

      <Section title="How we use it">
        <p>
          We use the data above for one purpose: to render performance
          dashboards for the client whose accounts the data came from. Each
          client&apos;s data is scoped to that client&apos;s view; we do
          not share data across clients, nor with third parties outside the
          processors listed below.
        </p>
      </Section>

      <Section title="Where data is stored">
        <p>
          All data is stored in <a className="underline" href="https://supabase.com" target="_blank" rel="noreferrer">Supabase</a>{" "}
          (Postgres + secrets vault) hosted on Amazon Web Services in the
          United States. Access tokens to third-party platforms (Meta,
          Google, TikTok, LinkedIn, GoHighLevel) are encrypted at rest
          using Supabase Vault. The application is hosted on{" "}
          <a className="underline" href="https://vercel.com" target="_blank" rel="noreferrer">Vercel</a>.
        </p>
      </Section>

      <Section title="How we protect your data">
        <p>
          We take reasonable and appropriate steps to protect the data
          described above against unauthorized access, use, alteration,
          loss, or disclosure. Security procedures are in place to protect
          the confidentiality of your information.
        </p>
        <p>
          <strong>Encryption in transit.</strong> All traffic between your
          browser and the dashboard, and between the dashboard and the
          third-party APIs we read from, is encrypted using HTTPS/TLS.
        </p>
        <p>
          <strong>Encryption at rest.</strong> Data stored in our database
          is held on encrypted infrastructure (Supabase on Amazon Web
          Services). The most sensitive data we hold — the OAuth access
          tokens that let us read your connected advertising and
          social-media accounts — is additionally encrypted in a dedicated
          secrets vault (Supabase Vault) and is never exposed to other
          clients or displayed in the dashboard.
        </p>
        <p>
          <strong>Access controls.</strong> Access to the dashboard
          requires authentication (Google OAuth or a one-time email link),
          and each client&apos;s data is scoped so that a signed-in user can
          only see their own organization&apos;s reporting. Administrative
          access to the underlying systems is limited to authorized Relay
          staff on a least-privilege basis. We review these
          safeguards periodically and will notify affected account holders
          if a breach ever materially affects their data.
        </p>
      </Section>

      <Section title="Third-party platforms we read from">
        <p>
          When you authorize Relay to connect a third-party account,
          we use the official APIs of that platform to read the data
          described above. We do not store the raw user-facing content
          (post videos, ad creatives, etc.) — only the analytics about that
          content.
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Meta (Facebook Pages + Instagram) — via the Meta Graph API</li>
          <li>Google / YouTube — via the YouTube Data and Analytics APIs</li>
          <li>
            TikTok — via the TikTok Login Kit and Display API. With the
            account holder&apos;s consent we read their public profile
            (display name, username, avatar, bio, verified status), account
            statistics (follower, following, likes, and video counts), and
            the list of their public videos with per-video metrics (views,
            likes, comments, shares). We use the{" "}
            <code>user.info.basic</code>, <code>user.info.profile</code>,{" "}
            <code>user.info.stats</code>, and <code>video.list</code> scopes
            for this, and only to display the account&apos;s own performance
            back to the account holder inside the dashboard.
          </li>
          <li>LinkedIn — via the LinkedIn Community Management API</li>
          <li>GoHighLevel — via the GHL API</li>
        </ul>
      </Section>

      <Section title="How we handle Google user data">
        <p>
          When you connect a Google account (for example Google Search
          Console, Google Analytics, or YouTube), we request only the
          read-only reporting scopes needed to display your performance
          metrics inside the dashboard, and we handle that data exactly as
          described elsewhere in this policy.
        </p>
        <p>
          Relay&apos;s use and transfer of information received from
          Google APIs adheres to the{" "}
          <a
            className="underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including its Limited Use requirements. Specifically, we do{" "}
          <strong>not</strong> use Google user data to serve advertising, to
          train generalized or non-personalized artificial-intelligence or
          machine-learning models, or to determine creditworthiness or for
          any lending purpose, and we do <strong>not</strong> sell Google
          user data or transfer it to data brokers or other parties.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Clients can revoke our access to any platform at any time, either
          by clicking &ldquo;Disconnect&rdquo; in the dashboard&apos;s
          Admin section or by revoking the OAuth grant directly in the
          platform&apos;s settings (e.g. Facebook Business Settings,
          Google Account → Security → Third-party access).
        </p>
        <p>
          To request deletion of all data associated with your account or
          your client&apos;s organization, email{" "}
          <a className="underline" href="mailto:vladimircuc007@gmail.com">
            vladimircuc007@gmail.com
          </a>
          . We will action the request within 30 days and confirm via email
          when complete.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          We use first-party cookies only, scoped to the dashboard domain.
          One cookie holds your Supabase authentication session; another
          remembers UI preferences (last-viewed period, simple/advanced
          tier toggle, recently-viewed clients). We do not use third-party
          tracking cookies, analytics scripts, or ad pixels on the
          dashboard.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If we make material changes to this policy we&apos;ll update the
          &ldquo;Last updated&rdquo; date at the top, and where appropriate
          email account holders.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions or concerns about this policy or your data:
          <br />
          <a className="underline" href="mailto:vladimircuc007@gmail.com">
            vladimircuc007@gmail.com
          </a>
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
      <div className="text-sm text-[var(--text-secondary)] leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}
