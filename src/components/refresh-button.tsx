"use client";

/**
 * "Refresh data" pill in the dashboard header. In the live product this triggers
 * an on-demand Meta + Asera pull; the demo runs on fixed synthetic data, so the
 * button opens a "how the pipeline works" explainer instead of running anything.
 */
import { RefreshCw, Database } from "lucide-react";
import { HowItWorks } from "@/components/how-it-works";

type Props = { clientId: string; clientSlug: string };

export function RefreshButton({ clientId, clientSlug }: Props) {
  // Referenced so the production-shaped props stay part of the component contract.
  void clientId;
  void clientSlug;

  return (
    <HowItWorks
      title="Refreshing data, in production"
      Icon={Database}
      intro="The live product pulls the latest numbers on demand. This demo runs on a fixed year of synthetic data, so here's how that pipeline actually works."
      steps={[
        { title: "Server-side ETL", body: "A POST to /api/refresh/<clientId> runs a Meta Ads + Asera (CRM) pull on the server and upserts normalized rows into Postgres. The browser never touches a provider API or an access token." },
        { title: "Rate-limited", body: "A 60-second per-client cooldown plus an in-flight guard (read from the latest etl_runs row) keeps the upstream APIs from being hammered." },
        { title: "Also runs nightly", body: "The same job runs on a schedule via /api/cron/daily so the dashboard stays current without anyone clicking Refresh." },
      ]}
      security={{ body: "The cron/ETL endpoints verify a bearer secret with a constant-time comparison, and a client's data is reachable only through the same server-side authorization as every dashboard read (Postgres RLS + the access resolver)." }}
      footnote="Demo — no real refresh runs."
    >
      {(open) => (
        <button
          type="button"
          onClick={open}
          title="How refreshing works in production"
          className="group relative inline-flex h-9 items-center gap-2 rounded-full border border-[var(--surface-3)]/80 bg-[var(--surface-2)] pl-2 pr-3 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--ps-yellow)]/60 hover:text-[var(--text-primary)]"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-1)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/asera-icon.png" alt="" className="h-3.5 w-3.5 object-contain" aria-hidden />
          </span>
          <RefreshCw size={13} className="transition-transform duration-[400ms] group-hover:rotate-180" />
          <span className="whitespace-nowrap">Refresh</span>
        </button>
      )}
    </HowItWorks>
  );
}
