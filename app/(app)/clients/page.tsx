import Link from "next/link";
import { CLIENTS, SERVICE_LABEL } from "@/lib/demo-data";
import { SectionTitle } from "@/components/ui";
import { InfoPopover } from "@/components/info";
import { MiniSpark } from "@/components/charts";
import { usd } from "@/lib/format";

export default function ClientsPage() {
  return (
    <div>
      <SectionTitle
        kicker="super admin"
        title="Clients"
        action={
          <InfoPopover title="Multi-tenant access control" label="How access works" align="right">
            Each client is a tenant. Every tenant table is protected by Postgres{" "}
            <strong className="text-ink">row-level security</strong> — a client user only ever sees rows for their own
            client, enforced by the database, not the app code. As a super-admin (this demo) you see all of them.
            Access is resolved server-side from the session; the URL only selects which tenant to view.
          </InfoPopover>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CLIENTS.map((c) => (
          <Link key={c.slug} href={`/c/${c.slug}`} className="card card-hover block p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.accent }} />
                <span className="font-semibold tracking-tight">{c.name}</span>
              </span>
              <span className="text-faint">→</span>
            </div>
            <div className="mt-1 text-xs text-dim">{c.industry}</div>

            <div className="mt-4 flex items-end justify-between gap-3">
              <div>
                <div className="text-xs text-dim">Revenue · 30d</div>
                <div className="text-xl font-semibold tracking-tight">{usd(c.revenue, true)}</div>
              </div>
              <MiniSpark data={c.revenueTrend} />
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {c.services.map((s) => (
                <span
                  key={s}
                  className="rounded border border-border-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-dim"
                >
                  {SERVICE_LABEL[s]}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
