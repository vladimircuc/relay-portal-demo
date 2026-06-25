/**
 * READ-ONLY: disentangle "ads stopped" from "data still settling" for the
 * Socials chart tail. For one client (default stl-sports-clinic) it lines up,
 * per day for the last ~14 days:
 *   - Meta ad spend (meta_daily.spend) — when did ads actually stop?
 *   - STORED Facebook + Instagram impressions (social_daily_metrics) + when
 *     the IG row was last fetched.
 *   - LIVE re-pull right now of IG `views` (per-day) and FB page_media_view
 *     split organic vs paid — so we can see (a) whether recent stored IG
 *     numbers are just incomplete (live > stored ⇒ settling), and (b) how much
 *     of FB is paid vs organic day by day.
 *
 * SELECT-only on our DB; GET-only against Graph. Token from Vault, NEVER
 * printed (bodies scrubbed). Safe on prod.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/probe-stlsc-settling.ts [slug] [days]
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";
import { META_API_VERSION } from "../src/lib/meta-oauth";

const G = `https://graph.facebook.com/${META_API_VERSION}`;
const SLUG = process.argv[2] ?? "stl-sports-clinic";
const DAYS = Number(process.argv[3] ?? 14);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function getJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return await res.json();
  } catch {
    return {};
  }
}

async function main() {
  const sb = createAdminClient();
  const { data: client } = await sb.from("clients").select("id, slug").eq("slug", SLUG).maybeSingle();
  if (!client) throw new Error(`no client ${SLUG}`);
  const { data: cred } = await sb
    .from("client_social_credentials")
    .select("access_token_secret_id, fb_page_id, ig_user_id")
    .eq("client_id", client.id)
    .not("fb_page_id", "is", null)
    .maybeSingle();
  const token = cred?.access_token_secret_id ? await getVaultSecret(sb, cred.access_token_secret_id) : null;

  const today = new Date();
  const start = new Date(today.getTime() - DAYS * 86_400_000);
  const startDay = ymd(start);

  // ── stored daily metrics ──────────────────────────────────────────────
  const { data: sdm } = await sb
    .from("social_daily_metrics")
    .select("platform, day, impressions, engagements, fetched_at")
    .eq("client_id", client.id)
    .gte("day", startDay)
    .order("day");
  type Cell = { imp: number; eng: number; fetched: string };
  const fb = new Map<string, Cell>();
  const ig = new Map<string, Cell>();
  for (const r of sdm ?? []) {
    const cell = { imp: num(r.impressions), eng: num(r.engagements), fetched: String(r.fetched_at ?? "").slice(0, 10) };
    if (r.platform === "meta_facebook") fb.set(r.day, cell);
    else if (r.platform === "meta_instagram") ig.set(r.day, cell);
  }

  // ── ad spend per day ──────────────────────────────────────────────────
  const { data: md } = await sb
    .from("meta_daily")
    .select("day, spend, impressions")
    .eq("client_id", client.id)
    .gte("day", startDay)
    .order("day");
  const spend = new Map<string, { spend: number; imp: number }>();
  for (const r of md ?? []) spend.set(r.day, { spend: num(r.spend), imp: num(r.impressions) });

  // ── LIVE re-pull: FB organic/paid split per day (one call) ────────────
  const fbLive = new Map<string, { org: number; paid: number }>();
  if (token && cred?.fb_page_id) {
    const since = Math.floor(start.getTime() / 1000);
    const until = Math.floor(today.getTime() / 1000);
    const body = await getJson(
      `${G}/${cred.fb_page_id}/insights?metric=page_media_view&period=day&metric_type=total_value&breakdown=is_from_ads&since=${since}&until=${until}&access_token=${token}`,
    );
    const m = (body?.data ?? []).find((d: any) => d.name === "page_media_view" && d.period === "day");
    for (const v of m?.values ?? []) {
      const day = ymd(new Date(new Date(v.end_time).getTime() - 86_400_000));
      const cur = fbLive.get(day) ?? { org: 0, paid: 0 };
      if (String(v.is_from_ads) === "1") cur.paid += num(v.value);
      else cur.org += num(v.value);
      fbLive.set(day, cur);
    }
  }

  // ── LIVE re-pull: IG views per day (1-day windows, last 8 days) ───────
  const igLive = new Map<string, number>();
  if (token && cred?.ig_user_id) {
    for (let i = 0; i < 8; i++) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const s = Math.floor(new Date(ymd(d) + "T00:00:00Z").getTime() / 1000);
      const body = await getJson(
        `${G}/${cred.ig_user_id}/insights?metric=views&period=day&metric_type=total_value&since=${s}&until=${s + 86_400}&access_token=${token}`,
      );
      const tv = body?.data?.[0]?.total_value?.value;
      if (typeof tv === "number") igLive.set(ymd(d), tv);
    }
  }

  // ── print merged table ────────────────────────────────────────────────
  const days: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) days.push(ymd(new Date(today.getTime() - i * 86_400_000)));
  console.log(`STLSC daily — stored vs live (window ${startDay} → ${ymd(today)})`);
  console.log(
    `${"day".padEnd(11)}${"spend".padStart(8)}${"FBimp(st)".padStart(11)}${"FBorg(live)".padStart(12)}${"FBpaid(live)".padStart(13)}${"IGimp(st)".padStart(11)}${"IGviews(live)".padStart(14)}  IGfetched`,
  );
  for (const day of days) {
    const f = fb.get(day);
    const i = ig.get(day);
    const fl = fbLive.get(day);
    const il = igLive.get(day);
    const sp = spend.get(day);
    console.log(
      `${day.padEnd(11)}` +
        `${(sp ? `$${sp.spend.toFixed(0)}` : "—").padStart(8)}` +
        `${String(f?.imp ?? "—").padStart(11)}` +
        `${String(fl ? fl.org : "—").padStart(12)}` +
        `${String(fl ? fl.paid : "—").padStart(13)}` +
        `${String(i?.imp ?? "—").padStart(11)}` +
        `${String(il ?? "—").padStart(14)}` +
        `  ${i?.fetched ?? "—"}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
