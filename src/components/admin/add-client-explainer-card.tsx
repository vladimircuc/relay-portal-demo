"use client";

/**
 * Demo replacement for the "+ Add a client" entry point on /clients.
 *
 * In the live product this links to a multi-step onboarding form that creates a
 * tenant. The demo keeps the exact dashed-card look but opens a "how onboarding
 * works in production" explainer instead of navigating to the form.
 */
import { Plus, UserPlus } from "lucide-react";
import { HowItWorks } from "@/components/how-it-works";

export function AddClientExplainerCard() {
  return (
    <li>
      <HowItWorks
        title="Onboarding a client, in production"
        Icon={UserPlus}
        intro="Staff create a new client here — its name, URL slug, brand, entitled services, and first admin. Here's what happens when you submit."
        steps={[
          {
            title: "Reserved, unique slug",
            body: "The slug becomes the client's URL (/acme). It's checked for uniqueness and against a reserved-word list server-side, so two tenants can never collide or shadow a system route.",
          },
          {
            title: "Provisions the tenant",
            body: "One server action creates the client row, seeds its default lifecycle phases, and writes the first access grant — so the new tenant is immediately consistent rather than half-created.",
          },
          {
            title: "Privileged operation",
            body: "Only a global super-admin can onboard a client; it stands up a brand-new access surface, so it's deliberately the most gated write in the app.",
          },
        ]}
        security={{
          body: "Creation runs under the service role on the server, and from the first row the new tenant's data is isolated by the same row-level security every other client relies on.",
        }}
        footnote="Demo — no client is created."
      >
        {(open) => (
          <button
            type="button"
            onClick={open}
            className="block w-full bg-transparent border border-dashed border-[var(--surface-3)]/60 rounded-[var(--radius-card)] p-6 hover:border-[var(--ps-yellow)]/60 hover:bg-[var(--surface-1)]/40 transition-all group h-full min-h-[88px]"
          >
            <div className="flex items-center justify-center gap-3 h-full text-[var(--text-tertiary)] group-hover:text-[var(--accent-fg)] transition-colors">
              <Plus size={20} />
              <span className="text-sm font-medium">Add a client</span>
            </div>
          </button>
        )}
      </HowItWorks>
    </li>
  );
}
