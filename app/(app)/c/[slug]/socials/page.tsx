import { notFound } from "next/navigation";
import { getClient } from "@/lib/demo-data";
import { Stat, Card, SectionTitle, Delta } from "@/components/ui";
import { InfoPopover } from "@/components/info";
import { compact, pct } from "@/lib/format";

export default async function Socials({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getClient(slug);
  if (!c) notFound();

  const totalFollowers = c.social.reduce((a, s) => a + s.followers, 0);
  const connected = c.social.filter((s) => s.connected).length;
  const avgEng = c.social.length ? c.social.reduce((a, s) => a + s.engagement, 0) / c.social.length : 0;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total followers" value={compact(totalFollowers)} />
        <Stat label="Connected accounts" value={`${connected}/${c.social.length}`} />
        <Stat label="Avg engagement" value={pct(avgEng)} />
      </div>

      <Card className="p-5">
        <SectionTitle
          title="Connected accounts"
          action={
            <InfoPopover title="How tokens are stored" label="How tokens are secured" align="right">
              Each account is connected by OAuth. The access and refresh tokens are stored encrypted at rest in a
              secrets vault — only an opaque vault id lands in the database, and a token value never reaches the
              browser. ETL mints short-lived access tokens from the refresh token server-side at run time.
            </InfoPopover>
          }
        />
        <div className="grid gap-2">
          {c.social.map((s) => (
            <div
              key={s.platform}
              className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium capitalize">{s.platform}</div>
                <div className="text-xs text-dim">{s.handle}</div>
              </div>
              <div className="flex items-center gap-5">
                <div className="text-right">
                  <div className="text-sm font-semibold">{compact(s.followers)}</div>
                  <div className="text-[10px] text-faint">followers</div>
                </div>
                <Delta value={s.growth} />
                {s.connected ? (
                  <span className="rounded-full border border-good/40 bg-good/10 px-2 py-0.5 text-[10px] text-good">
                    connected
                  </span>
                ) : (
                  <span className="rounded-full border border-border-2 px-2 py-0.5 text-[10px] text-faint">
                    not connected
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
