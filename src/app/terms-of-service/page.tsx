/**
 * Public Terms of Service page.
 *
 * Lives at vladimircuc.com/terms-of-service. Stays public (no auth)
 * so OAuth platform reviewers can scrape it — see privacy page docs for the
 * same reasoning. The proxy.ts PUBLIC_PATHS list allows /terms-of-service
 * through. The path matches TikTok's required convention verbatim.
 *
 * Scope note: this is an INTERNAL dashboard for Relay staff +
 * designated client contacts to view performance data. It's not a SaaS
 * product the public signs up for. The terms reflect that — short,
 * practical, scoped to the dashboard's actual surface.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { FixedThemeToggle } from "@/components/ui/theme-toggle";

export const metadata: Metadata = {
  // Title leads with the app name verbatim ("Relay Terms of Service") —
  // TikTok app review requires the ToS page title to display the app name.
  title: "Relay Terms of Service",
  description:
    "Terms governing access to and use of the Relay agency reporting dashboard.",
};

const LAST_UPDATED = "May 28, 2026";

export default function TermsPage() {
  return (
    <main className="w-full max-w-3xl mx-auto px-6 py-16 flex flex-col gap-6">
      <FixedThemeToggle />
      <header className="flex flex-col gap-2 border-b border-[var(--surface-3)]/40 pb-6">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">Relay Terms of Service</h1>
        <p className="text-sm text-[var(--text-secondary)]">Last updated: {LAST_UPDATED}</p>
      </header>

      <Section title="What this is">
        <p>
          Relay operates a private agency reporting dashboard at{" "}
          <code>vladimircuc.com</code> (&ldquo;the Dashboard&rdquo;). Access
          is granted only to Relay staff and to individual contacts
          at our client organizations whose emails we&apos;ve explicitly
          allowed. By signing in, you agree to these terms.
        </p>
      </Section>

      <Section title="What the Dashboard does">
        <p>
          The Dashboard reads marketing-performance data from third-party
          platforms (Meta Ads, Facebook Pages, Instagram, TikTok, YouTube,
          LinkedIn, GoHighLevel) on behalf of the client, and presents that
          data in a unified reporting view. Client organizations grant
          access via OAuth or stored API credentials; revocation is
          available at any time inside the Dashboard or in the underlying
          platform settings.
        </p>
      </Section>

      <Section title="Your responsibilities">
        <ul className="list-disc pl-6 space-y-1">
          <li>
            Keep your sign-in credentials confidential. We use Google
            OAuth or magic-link email auth via Supabase — share neither.
          </li>
          <li>
            Only connect accounts you are authorized to grant access to.
            Connecting a client&apos;s account without authorization is a
            violation of these terms and the platforms&apos; own terms.
          </li>
          <li>
            Don&apos;t use the Dashboard to circumvent any third-party
            platform&apos;s rate limits, data-access policies, or terms.
          </li>
        </ul>
      </Section>

      <Section title="Data and privacy">
        <p>
          The data we read from connected accounts is governed by our{" "}
          <Link className="underline" href="/privacy-policy">
            Privacy Policy
          </Link>
          . In short: we collect only the metrics necessary to render the
          dashboard, store access tokens encrypted, scope each client&apos;s
          data to that client, and don&apos;t share data across clients or
          with third parties beyond our hosting providers (Supabase and
          Vercel).
        </p>
      </Section>

      <Section title="Availability">
        <p>
          We aim for high availability but do not guarantee uninterrupted
          service. The Dashboard depends on third-party platform APIs which
          may have their own outages, rate limits, and deprecation notices
          outside our control.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          We may revoke access for any user or client organization at our
          discretion. Clients may request access removal at any time by
          emailing{" "}
          <a className="underline" href="mailto:vladimircuc007@gmail.com">
            vladimircuc007@gmail.com
          </a>
          . On termination we delete the client&apos;s data within 30 days,
          unless retention is required for legal or audit purposes.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          The Dashboard is provided &ldquo;as is.&rdquo; To the maximum
          extent permitted by law, Relay is not liable for indirect,
          incidental, or consequential damages arising from use of the
          Dashboard, including but not limited to business decisions made
          on the basis of the data presented. Always cross-reference
          critical decisions against the underlying platforms&apos; native
          reporting.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update these terms from time to time. Material changes
          will be reflected by an updated &ldquo;Last updated&rdquo; date
          at the top, and where appropriate communicated by email.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions:{" "}
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
