/**
 * READ-ONLY: measure the organic vs paid (boosted) split of our Facebook
 * Page social metrics, to scope the "organic-only socials" change.
 *
 * Impressions (page_media_view) DO split by is_from_ads when requested with
 * metric_type=total_value — each day returns two entries tagged
 * is_from_ads:"0" (organic) and "1" (paid). Engagement (page_post_engagements)
 * does NOT support the breakdown (verified via probe-meta-breakdown-formats),
 * so we can only report its blended total here.
 *
 * For every client with a connected Facebook Page this reports, over the last
 * N days: the impressions total split into organic/paid, the (unsplittable)
 * engagement total, and the client's Meta ad spend over the same window
 * (meta_daily.spend). The partition check (plain == organic+paid) is what
 * guarantees the planned filter is a NO-OP for clients with no ad delivery.
 *
 * SELECT-only on our DB; GET-only against Graph. No writes, no PII (aggregate
 * counts + slugs). Token is read from Vault, NEVER printed (scrubbed from any
 * echoed body — Meta embeds it in paging URLs). Safe on prod.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/probe-meta-organic-split.ts [days]
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";
import { META_API_VERSION } from "../src/lib/meta-oauth";

const G = `https://graph.facebook.com/${META_API_VERSION}`;
const DAYS = Number(process.argv[2] ?? 14);

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isAdKey = (k: string) => ["1", "true", "ads", "paid"].includes(String(k).trim().toLowerCase());
// Meta echoes the access_token in paging.next/previous URLs — scrub any body.
const scrub = (s: string) =>
  s.replace(/access_token=[^&"\\]+/g, "access_token=REDACTED").replace(/EAA[A-Za-z0-9]{20,}/g, "TOKEN_REDACTED");

async function getJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return await res.json();
  } catch {
    return {};
  }
}

/** Sum the period=day values of a plain metric (no breakdown). */
function sumPlain(body: any, metric: string): number {
  const m = (body?.data ?? []).find((d: any) => d.name === metric && d.period === "day");
  return (m?.values ?? []).reduce((a: number, v: any) => a + num(v.value), 0);
}

/** Split a metric_type=total_value&breakdown=is_from_ads response into
 *  organic vs paid using the is_from_ads sibling key on each daily value. */
function splitByAds(body: any, metric: string): { organic: number; paid: number; tagged: boolean } {
  const m = (body?.data ?? []).find((d: any) => d.name === metric && d.period === "day");
  let organic = 0;
  let paid = 0;
  let tagged = false;
  for (const v of m?.values ?? []) {
    if (typeof v?.is_from_ads === "string") {
      tagged = true;
      if (isAdKey(v.is_from_ads)) paid += num(v.value);
      else organic += num(v.value);
    } else {
      organic += num(v.value); // breakdown didn't apply
    }
  }
  return { organic, paid, tagged };
}

async function adSpend(sb: any, clientId: string, sinceDay: string, untilDay: string): Promise<number> {
  const { data } = await sb
    .from("meta_daily")
    .select("spend")
    .eq("client_id", clientId)
    .gte("day", sinceDay)
    .lte("day", untilDay);
  return (data ?? []).reduce((a: number, r: any) => a + num(r.spend), 0);
}

const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—");

async function main() {
  const sb = createAdminClient();
  const until = new Date();
  const since = new Date(until.getTime() - DAYS * 86_400_000);
  const sinceSec = Math.floor(since.getTime() / 1000);
  const untilSec = Math.floor(until.getTime() / 1000);
  const sinceDay = since.toISOString().slice(0, 10);
  const untilDay = until.toISOString().slice(0, 10);

  const { data: clients, error } = await sb.from("clients").select("id, slug").order("slug");
  if (error) throw error;

  console.log(`Window ${sinceDay} → ${untilDay} (${DAYS}d)\n`);

  for (const c of clients ?? []) {
    const { data: cred } = await sb
      .from("client_social_credentials")
      .select("access_token_secret_id, fb_page_id")
      .eq("client_id", c.id)
      .not("fb_page_id", "is", null)
      .maybeSingle();
    if (!cred?.fb_page_id || !cred.access_token_secret_id) continue;

    let token: string;
    try {
      token = await getVaultSecret(sb, cred.access_token_secret_id);
    } catch (e) {
      console.log(`${c.slug}: token error ${(e as Error).message}`);
      continue;
    }

    const tail = `since=${sinceSec}&until=${untilSec}&access_token=${token}`;
    const plain = await getJson(`${G}/${cred.fb_page_id}/insights?metric=page_media_view,page_post_engagements&period=day&${tail}`);
    const brk = await getJson(`${G}/${cred.fb_page_id}/insights?metric=page_media_view&metric_type=total_value&breakdown=is_from_ads&${tail}`);
    if (brk?.error) console.log(`  (impressions breakdown error: ${scrub(JSON.stringify(brk.error))})`);

    const impPlain = sumPlain(plain, "page_media_view");
    const engPlain = sumPlain(plain, "page_post_engagements");
    const { organic, paid, tagged } = splitByAds(brk, "page_media_view");
    const spend = await adSpend(sb, c.id, sinceDay, untilDay);

    // Partition check: plain total must equal organic+paid. If it holds, then
    // for any client with paid=0 the organic value == today's stored value
    // exactly → the filter is a guaranteed no-op for non-advertising clients.
    const partitionOk = impPlain === organic + paid;

    console.log(`${c.slug}   ${spend > 0 ? `ADS $${spend.toFixed(0)}` : "no-ads"}`);
    console.log(
      `   impressions  total=${impPlain}  organic=${organic}  paid=${paid} (${pct(paid, impPlain)} paid)` +
        `  partition ${partitionOk ? "OK" : `MISMATCH (split=${organic + paid})`}${tagged ? "" : "  [NOT tagged!]"}`,
    );
    console.log(`   engagement   total=${engPlain}  (no is_from_ads breakdown available — blended)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
