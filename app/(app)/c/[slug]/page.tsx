import { notFound } from "next/navigation";
import { getClient } from "@/lib/demo-data";
import { Stat, Card, SectionTitle } from "@/components/ui";
import { AreaTrend, FunnelBars } from "@/components/charts";
import { InfoPopover } from "@/components/info";
import { usd } from "@/lib/format";

export default async function Overview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getClient(slug);
  if (!c) notFound();

  const isEcom = c.leads === 0;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue · 30d" value={usd(c.revenue, true)} delta={c.d.revenue} />
        <Stat label="Ad spend · 30d" value={usd(c.spend, true)} delta={c.d.spend} invert />
        <Stat label="ROAS" value={`${c.roas.toFixed(1)}×`} delta={c.d.roas} />
        <Stat
          label={isEcom ? "Orders" : "Leads"}
          value={(isEcom ? c.conversions : c.leads).toLocaleString()}
          delta={c.d.leads}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <SectionTitle title="Revenue trend" action={<DataInfo />} />
          <AreaTrend data={c.revenueTrend} height={130} />
          <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
            <span>12 weeks ago</span>
            <span>now</span>
          </div>
        </Card>
        <Card className="p-5">
          <SectionTitle title={isEcom ? "Conversion funnel" : "Lead funnel"} />
          <FunnelBars steps={c.funnel} />
        </Card>
      </div>
    </div>
  );
}

function DataInfo() {
  return (
    <InfoPopover title="Where this data comes from" label="How the data pipeline works" align="right">
      In production a scheduled ETL pulls from the Meta, CRM and Google APIs server-side, normalizes it and upserts
      into Postgres. The pull endpoints are authed with a cron secret compared in constant time, and the manual
      &quot;Refresh&quot; runs the same job, rate-limited per client. The browser never touches a provider API or a
      token.
    </InfoPopover>
  );
}
