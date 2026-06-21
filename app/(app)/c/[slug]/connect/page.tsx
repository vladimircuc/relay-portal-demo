import { notFound } from "next/navigation";
import { getClient } from "@/lib/demo-data";
import { Card, SectionTitle } from "@/components/ui";
import { InfoPopover } from "@/components/info";

const PLATFORMS = [
  { key: "instagram", name: "Instagram", detail: "Business login via the Meta Graph API" },
  { key: "facebook", name: "Facebook Pages", detail: "Page tokens via Meta Business Login" },
  { key: "tiktok", name: "TikTok", detail: "OAuth 2.0 with PKCE" },
  { key: "youtube", name: "YouTube", detail: "Google OAuth — read-only analytics" },
  { key: "linkedin", name: "LinkedIn", detail: "Member auth + organization ACLs" },
] as const;

export default async function Connect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getClient(slug);
  if (!c) notFound();

  const connectedSet = new Set(c.social.filter((s) => s.connected).map((s) => s.platform));

  return (
    <div className="grid gap-6">
      <Card className="p-5">
        <SectionTitle kicker="oauth" title="Connect platforms" />
        <p className="-mt-2 mb-4 max-w-2xl text-sm text-dim">
          Link this client&apos;s social and ad accounts so Relay can pull their analytics. Each connection is an OAuth
          grant scoped to this one tenant.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map((p) => {
            const isConnected = connectedSet.has(p.key);
            return (
              <div
                key={p.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-2/40 px-4 py-3.5"
              >
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-dim">{p.detail}</div>
                </div>
                {isConnected ? (
                  <span className="flex items-center gap-2">
                    <span className="rounded-full border border-good/40 bg-good/10 px-2 py-0.5 text-[10px] text-good">
                      connected
                    </span>
                    <InfoPopover title={`Connecting ${p.name}`} label="reconnect" align="right">
                      <ConnectExplainer name={p.name} />
                    </InfoPopover>
                  </span>
                ) : (
                  <InfoPopover title={`Connecting ${p.name}`} label="Connect →" align="right">
                    <ConnectExplainer name={p.name} />
                  </InfoPopover>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs leading-relaxed text-dim">
          <span className="font-medium text-accent">Real-world detail:</span> getting these approved was its own
          project — Meta App Review, the TikTok app audit, Google&apos;s OAuth brand verification and LinkedIn&apos;s
          Community Management API review each needed a privacy policy, a demo video and scope justification before
          going live.
        </div>
      </Card>
    </div>
  );
}

function ConnectExplainer({ name }: { name: string }) {
  return (
    <>
      Clicking Connect would start an OAuth flow for {name}. The <strong className="text-ink">state</strong> parameter
      is HMAC-signed with a server-only secret and carries this client&apos;s id, so a forged or replayed callback
      cannot bind the grant to another tenant. PKCE is used where the provider supports it. On callback the server
      re-checks that you can access this client, exchanges the code, and stores the tokens encrypted in a vault — never
      in the browser.
    </>
  );
}
