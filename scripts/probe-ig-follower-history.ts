/**
 * Probe: can IG `follower_count` be backfilled by paging BACKWARD in 30-day
 * windows? Our ETL only fetches the most recent 30 days; the docs say the
 * metric retains ~2 years. Test past windows to find the real reachable depth.
 * usage: tsx --env-file=.env.local scripts/probe-ig-follower-history.ts <slug>
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";

const G = `https://graph.facebook.com/v25.0`;
const DAY = 86_400;

async function get(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) as any }; }
  catch { return { status: res.status, body: text as any }; }
}

async function main() {
  const slug = process.argv[2] ?? "varble-orthodontics";
  const supabase = createAdminClient();
  const { data: client } = await supabase.from("clients").select("id").eq("slug", slug).maybeSingle();
  const { data: creds } = await supabase.from("client_social_credentials")
    .select("access_token_secret_id, ig_user_id")
    .eq("client_id", (client as any).id).eq("platform", "meta").maybeSingle();
  const c = creds as { access_token_secret_id: string; ig_user_id: string };
  const token = await getVaultSecret(supabase, c.access_token_secret_id);
  const ig = c.ig_user_id;
  console.log(`ig_user_id=${ig}`);

  const now = Math.floor(Date.now() / 1000);
  // windows: how many days back the END of each 28-day window sits.
  const offsets = [0, 30, 60, 120, 180, 270, 365, 540, 730];
  for (const off of offsets) {
    const until = now - off * DAY;
    const since = until - 28 * DAY;
    const url = `${G}/${ig}/insights?metric=follower_count&period=day&metric_type=time_series&since=${since}&until=${until}&access_token=${token}`;
    const r = await get(url);
    const label = `~${off}d ago`.padEnd(10);
    if (r.status !== 200) {
      const err = r.body?.error?.message ?? JSON.stringify(r.body).slice(0, 120);
      console.log(`  ${label} ❌ ${r.status}  ${String(err).slice(0, 130)}`);
      continue;
    }
    const vals = r.body?.data?.[0]?.values ?? [];
    const nums = vals.filter((v: any) => typeof v.value === "number");
    const days = nums.map((v: any) => (v.end_time ?? "").slice(0, 10));
    const sum = nums.reduce((a: number, v: any) => a + v.value, 0);
    console.log(`  ${label} ✅ n=${nums.length} sumGained=${sum}  ${days[0] ?? "-"}..${days[days.length-1] ?? "-"}`);
  }
}
main().catch(e => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
