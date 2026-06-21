import { notFound } from "next/navigation";
import { getClient } from "@/lib/demo-data";
import { Stat, Card, SectionTitle } from "@/components/ui";
import { AreaTrend } from "@/components/charts";
import { InfoPopover } from "@/components/info";
import { usd } from "@/lib/format";

export default async function Ads({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getClient(slug);
  if (!c) notFound();

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Spend · 30d" value={usd(c.spend)} delta={c.d.spend} invert />
        <Stat label="Revenue · 30d" value={usd(c.revenue)} delta={c.d.revenue} />
        <Stat label="ROAS" value={`${c.roas.toFixed(1)}×`} delta={c.d.roas} />
        <Stat label="Cost / lead" value={c.cpl ? usd(c.cpl) : "—"} invert />
      </div>

      <Card className="p-5">
        <SectionTitle title="Ad spend · 12 weeks" action={<ReportButton />} />
        <AreaTrend data={c.spendTrend} height={130} stroke="var(--color-accent-2)" />
        <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
          <span>12 weeks ago</span>
          <span>now</span>
        </div>
      </Card>
    </div>
  );
}

function ReportButton() {
  return (
    <div className="flex items-center gap-2">
      <InfoPopover title="The PDF report builder" label="How reports work" align="right">
        Reports render server-side with headless Chromium into a branded PDF. Client-supplied fields are escaped for
        HTML attribute context, and any logo the template fetches goes through an SSRF guard: private, link-local and
        cloud-metadata hosts are blocked, and the session cookie is only ever forwarded to our own origin.
      </InfoPopover>
      <button
        type="button"
        className="cursor-not-allowed rounded-md border border-border-2 px-3 py-1.5 text-xs text-dim"
        title="Demo — no file is generated"
      >
        Download report
      </button>
    </div>
  );
}
