/**
 * READ-ONLY: check whether our Instagram numbers are organic or include paid
 * (boosted) delivery — the FB probe showed FB is ~98% paid, so the "IG is
 * already organic" assumption (from Meta's docs, not measured) needs a real
 * check against a client's actual posts.
 *
 * For one client (default stl-sports-clinic) it prints:
 *   - account-level `views` total over the window (what igDailyRows stores as
 *     IG "impressions"), and whether IG accepts an is_from_ads breakdown.
 *   - recent media with per-post views/reach, likes/comments, and a BOOST
 *     signal (media.boost_ads_list — ad ids promoting that organic post).
 * So we can find the ~4k-view post, see if it was boosted, and judge whether
 * its count is organic or paid-inflated.
 *
 * GET-only against Graph; token from Vault, NEVER printed (bodies scrubbed —
 * Graph echoes the token in paging URLs). Safe on prod.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/probe-ig-organic.ts [slug]
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";
import { META_API_VERSION } from "../src/lib/meta-oauth";

const G = `https://graph.facebook.com/${META_API_VERSION}`;
const SLUG = process.argv[2] ?? "stl-sports-clinic";
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
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

async function main() {
  const sb = createAdminClient();
  const { data: client } = await sb.from("clients").select("id, slug").eq("slug", SLUG).maybeSingle();
  if (!client) throw new Error(`no client ${SLUG}`);
  const { data: cred } = await sb
    .from("client_social_credentials")
    .select("access_token_secret_id, ig_user_id")
    .eq("client_id", client.id)
    .not("ig_user_id", "is", null)
    .maybeSingle();
  if (!cred?.ig_user_id || !cred.access_token_secret_id) {
    console.log(`${SLUG}: no Instagram connected (ig_user_id null) — nothing to probe`);
    return;
  }
  const token = await getVaultSecret(sb, cred.access_token_secret_id);
  const ig = cred.ig_user_id;
  const until = Math.floor(Date.now() / 1000);
  const since = until - 14 * 86_400;
  const t = `access_token=${token}`;

  // 1) Account-level `views` total (what we store as IG impressions).
  const acct = await getJson(`${G}/${ig}/insights?metric=views&period=day&metric_type=total_value&since=${since}&until=${until}&${t}`);
  const acctViews = (acct?.data?.[0]?.total_value?.value ?? acct?.data?.[0]?.values?.reduce?.((a: number, v: any) => a + num(v.value), 0)) ?? "n/a";
  console.log(`IG account 'views' total (14d, what we store): ${acctViews}`);

  // 2) Does IG accept an is_from_ads breakdown at the account level? (FB does.)
  const acctBrk = await getJson(`${G}/${ig}/insights?metric=views&period=day&metric_type=total_value&breakdown=is_from_ads&since=${since}&until=${until}&${t}`);
  console.log(`IG account views + is_from_ads breakdown → ${acctBrk?.error ? `ERROR: ${scrub(JSON.stringify(acctBrk.error))}` : scrub(JSON.stringify(acctBrk?.data?.[0] ?? {})).slice(0, 600)}`);

  // 3) Recent media with boost signal + per-post views/reach.
  const media = await getJson(
    `${G}/${ig}/media?fields=id,media_type,media_product_type,timestamp,permalink,like_count,comments_count,boost_ads_list,boost_eligibility_info&limit=20&${t}`,
  );
  if (media?.error) {
    console.log(`media list error: ${scrub(JSON.stringify(media.error))}`);
    return;
  }
  // Does a single media's views split by is_from_ads? (definitive per-post test)
  const firstId = media?.data?.[0]?.id;
  if (firstId) {
    const mBrk = await getJson(`${G}/${firstId}/insights?metric=views&metric_type=total_value&breakdown=is_from_ads&${t}`);
    console.log(`media views + is_from_ads → ${mBrk?.error ? `ERROR: ${scrub(JSON.stringify(mBrk.error))}` : scrub(JSON.stringify(mBrk?.data?.[0] ?? {})).slice(0, 500)}`);
  }
  console.log(`\n${"date".padEnd(11)} ${"type".padEnd(13)} ${"views".padStart(7)} ${"reach".padStart(7)} ${"likes".padStart(6)} ${"cmts".padStart(5)}  boosted?`);
  for (const m of media?.data ?? []) {
    const ins = await getJson(`${G}/${m.id}/insights?metric=views,reach&${t}`);
    const byName: Record<string, number> = {};
    for (const d of ins?.data ?? []) byName[d.name] = num(d.values?.[0]?.value);
    const boostList = Array.isArray(m.boost_ads_list) ? m.boost_ads_list : [];
    const boosted = boostList.length > 0 ? `YES (${boostList.length} ad${boostList.length > 1 ? "s" : ""})` : "no";
    const date = String(m.timestamp ?? "").slice(0, 10);
    const type = `${m.media_type ?? "?"}/${m.media_product_type ?? "?"}`;
    console.log(
      `${date.padEnd(11)} ${type.padEnd(13)} ${String(byName.views ?? "—").padStart(7)} ${String(byName.reach ?? "—").padStart(7)} ${String(num(m.like_count)).padStart(6)} ${String(num(m.comments_count)).padStart(5)}  ${boosted}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
