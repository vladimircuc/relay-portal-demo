"use client";

/**
 * Per-source "Run now" button for the /admin → ETL Status section.
 *
 * In the live product this POSTs to /api/etl/<source>/<clientId> and streams a
 * fresh pull while a blocking overlay covers the page. The demo runs on a fixed
 * year of synthetic data, so the button opens a "how the pipeline works"
 * explainer instead — Meta backfills ~36 months and upserts; Asera paginates
 * every opportunity. The Props shape is unchanged so EtlSection stays identical
 * to the real app.
 */
import { Database } from "lucide-react";
import { cn } from "@/lib/cn";
import { HowItWorks, type ExplainerContent } from "@/components/how-it-works";

type Props = {
  clientId: string;
  /** "meta" → /api/etl/meta/<id>, "ghl" → /api/etl/ghl/<id>. */
  source: "meta" | "ghl";
  /** Label text on the resting button (e.g. "Run Meta backfill"). */
  children: React.ReactNode;
  /** Production-shaped props, kept on the contract but unused in the demo. */
  pendingLabel?: string;
  body?: Record<string, unknown>;
  overlayTitle?: string;
  overlaySubtitle?: string;
  overlayIconSrc?: string;
};

const META_ETL: ExplainerContent = {
  title: "Meta Ads backfill, in production",
  Icon: Database,
  intro:
    "Clicking this in the live product pulls the maximum range Meta allows — about 36 months — and overwrites overlapping days. Here's what runs.",
  steps: [
    {
      title: "Server-side pull",
      body: "A POST to /api/etl/meta/<clientId> hits the Meta Graph API on the server with the client's vaulted token, normalizes daily ad results, and upserts them into Postgres by primary key. The browser never sees a provider call.",
    },
    {
      title: "Idempotent upsert",
      body: "Re-running is safe — overlapping days are overwritten, not duplicated — and the run is recorded in etl_runs with row count, duration, and any error.",
    },
    {
      title: "Also nightly",
      body: "The same pull runs on a 5 AM cron, so a manual backfill is only needed for history or an immediate refresh.",
    },
  ],
  security: {
    body: "The endpoint authenticates a bearer secret with a constant-time comparison, the access token is read from Supabase Vault server-side, and every row is written under tenant-scoped RLS.",
  },
  footnote: "Demo — no real pull runs.",
};

const GHL_ETL: ExplainerContent = {
  title: "Asera sweep, in production",
  Icon: Database,
  intro:
    "In the live product this paginates every opportunity in the client's Asera (CRM) pipeline and upserts it. Here's how the sweep works.",
  steps: [
    {
      title: "Paginated server pull",
      body: "A POST to /api/etl/ghl/<clientId> walks every page of opportunities using the client's vaulted Asera token, maps each to its lifecycle phase via the stage mapping, and upserts into Postgres.",
    },
    {
      title: "Feeds the funnel",
      body: "These rows are what the dashboard funnel (Leads → Bookings → Shows → Conversions) and every conversion rate are computed from. The run is logged to etl_runs.",
    },
    {
      title: "Also nightly",
      body: "The same sweep runs on the 5 AM cron so the funnel stays current without anyone clicking.",
    },
  ],
  security: {
    body: "A per-client cooldown plus an in-flight guard keeps Asera from being hammered, the bearer secret is checked in constant time, and the token never leaves the server.",
  },
  footnote: "Demo — no real sweep runs.",
};

export function RunEtlButton({ source, children, clientId, body }: Props) {
  // Production-shaped props kept on the contract but inert in the demo.
  void clientId;
  void body;

  return (
    <HowItWorks {...(source === "meta" ? META_ETL : GHL_ETL)}>
      {(open) => (
        <button
          type="button"
          onClick={open}
          title="How this data pull works in production"
          className={cn(
            "text-[13px] font-semibold px-4 py-2.5 rounded-md transition-colors min-w-[72px]",
            "inline-flex items-center justify-center gap-2",
            "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)]",
          )}
        >
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{children}</span>
        </button>
      )}
    </HowItWorks>
  );
}
