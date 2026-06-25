/**
 * READ-ONLY SEO data-freshness check for one client. No PII (just dates +
 * run metadata). Usage: npx tsx --env-file=.env.local scripts/seo-freshness.ts [slug]
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing env"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const slug = process.argv[2] || "varble-orthodontics";

async function main() {
  const { data: client } = await sb.from("clients").select("id, slug").eq("slug", slug).maybeSingle();
  if (!client) { console.log(`no client '${slug}'`); return; }
  const id = (client as { id: string }).id;
  console.log(`client: ${slug}`);

  // Latest day per source in the GSC/Bing search table (drives the picker max).
  const { data: search } = await sb.from("seo_daily_metrics").select("source, day").eq("client_id", id).order("day", { ascending: false }).limit(400);
  const maxBySource = new Map<string, string>();
  for (const r of (search ?? []) as { source: string; day: string }[]) if (!maxBySource.has(r.source)) maxBySource.set(r.source, r.day);
  console.log("\nseo_daily_metrics latest day per source:");
  for (const [s, d] of maxBySource) console.log(`  ${s.padEnd(8)} ${d}`);

  const { data: ga } = await sb.from("seo_ga4_daily").select("day").eq("client_id", id).order("day", { ascending: false }).limit(1);
  console.log(`seo_ga4_daily latest day: ${(ga?.[0] as { day?: string })?.day ?? "—"}`);

  // Has a client_seo_config row? (gate for the cron pull)
  const { data: cfg } = await sb.from("client_seo_config").select("ga4_property_id, gsc_site_url, bing_site_url").eq("client_id", id).maybeSingle();
  console.log(`\nclient_seo_config: ${cfg ? "present" : "MISSING (cron seo pull no-ops without it)"}`);
  if (cfg) {
    const c = cfg as Record<string, unknown>;
    console.log(`  ga4_property_id: ${c.ga4_property_id ? "set" : "—"}  gsc_site_url: ${c.gsc_site_url ? "set" : "—"}  bing_site_url: ${c.bing_site_url ? "set" : "—"}`);
  }

  // Recent seo ETL runs.
  const { data: runs } = await sb.from("etl_runs").select("source, status, started_at, finished_at, error").eq("client_id", id).like("source", "seo%").order("started_at", { ascending: false }).limit(5);
  console.log("\nrecent seo etl_runs:");
  if (!runs || runs.length === 0) console.log("  (none — the SEO ETL has never run for this client)");
  for (const r of (runs ?? []) as Record<string, unknown>[]) {
    console.log(`  ${String(r.started_at).slice(0, 16)}  ${String(r.source).padEnd(10)} ${String(r.status).padEnd(8)} ${r.error ? "err: " + String(r.error).slice(0, 60) : ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
