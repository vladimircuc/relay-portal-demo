/**
 * READ-ONLY: per-day Meta ad impressions split by publisher_platform
 * (facebook / instagram / audience_network / messenger) for one client, to
 * test whether STLSC's Instagram account `views` drop when ads stop is paid
 * IG delivery vs an organic/posting-cadence effect. If IG ad impressions are
 * large on ad days and ~0 when spend stops — and that magnitude matches the
 * IG `views` drop — then our IG numbers include paid.
 *
 * Uses the ADS token (client_credentials.meta_access_token_secret_id). GET-only
 * against Graph; token from Vault, NEVER printed (bodies scrubbed). Safe on prod.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/probe-meta-placements.ts [slug] [days]
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";
import { META_API_VERSION } from "../src/lib/meta-oauth";

const G = `https://graph.facebook.com/${META_API_VERSION}`;
const SLUG = process.argv[2] ?? "stl-sports-clinic";
const DAYS = Number(process.argv[3] ?? 14);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const scrub = (s: string) =>
  s.replace(/access_token=[^&"\\]+/g, "access_token=REDACTED").replace(/EAA[A-Za-z0-9]{20,}/g, "TOKEN_REDACTED");

async function main() {
  const sb = createAdminClient();
  const { data: client } = await sb.from("clients").select("id, slug").eq("slug", SLUG).maybeSingle();
  if (!client) throw new Error(`no client ${SLUG}`);
  const { data: creds } = await sb
    .from("client_credentials")
    .select("meta_access_token_secret_id, meta_ad_account_id")
    .eq("client_id", client.id)
    .maybeSingle();
  if (!creds?.meta_access_token_secret_id || !creds.meta_ad_account_id) {
    console.log(`${SLUG}: no ad account configured`);
    return;
  }
  const token = await getVaultSecret(sb, creds.meta_access_token_secret_id);
  const acct = String(creds.meta_ad_account_id).startsWith("act_") ? creds.meta_ad_account_id : `act_${creds.meta_ad_account_id}`;

  const today = new Date();
  const since = ymd(new Date(today.getTime() - DAYS * 86_400_000));
  const until = ymd(today);

  const url =
    `${G}/${acct}/insights?fields=impressions,spend,reach&breakdowns=publisher_platform` +
    `&time_increment=1&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=500&access_token=${token}`;
  const body = await getJson(url);
  if (body?.error) {
    console.log(`ad insights error: ${scrub(JSON.stringify(body.error))}`);
    return;
  }

  // rows: one per (day, publisher_platform)
  const byDay = new Map<string, Record<string, number>>();
  for (const r of body?.data ?? []) {
    const day = r.date_start;
    const plat = r.publisher_platform ?? "?";
    const m = byDay.get(day) ?? {};
    m[plat] = num(r.impressions);
    m[`${plat}_spend`] = num(r.spend);
    byDay.set(day, m);
  }

  console.log(`${SLUG} — ad impressions by placement, per day (${since} → ${until})\n`);
  console.log(`${"day".padEnd(11)}${"FB ads".padStart(10)}${"IG ads".padStart(10)}${"audnet".padStart(9)}${"msgr".padStart(8)}${"spend".padStart(9)}`);
  const days = [...byDay.keys()].sort();
  for (const day of days) {
    const m = byDay.get(day)!;
    const spend = Object.entries(m).filter(([k]) => k.endsWith("_spend")).reduce((a, [, v]) => a + v, 0);
    console.log(
      `${day.padEnd(11)}${String(m.facebook ?? 0).padStart(10)}${String(m.instagram ?? 0).padStart(10)}` +
        `${String(m.audience_network ?? 0).padStart(9)}${String(m.messenger ?? 0).padStart(8)}${`$${spend.toFixed(0)}`.padStart(9)}`,
    );
  }
}

async function getJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return await res.json();
  } catch {
    return {};
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
