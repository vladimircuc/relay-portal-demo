/**
 * READ-ONLY freshness audit for one client across every data source.
 *
 * Prints, for the given client slug (default "varble"):
 *   - which platforms are connected (display names only — no secrets)
 *   - latest etl_runs row per source (status / when / rows)
 *   - row counts + min/max day + last fetched_at for meta_daily,
 *     ghl_opportunities, social_daily_metrics (per platform),
 *     social_posts (per platform), and social_backfill_jobs
 *
 * SELECT-only. Never prints tokens or vault secret ids. Safe to run against
 * prod. Usage:
 *   npx tsx --env-file=.env.local scripts/audit-client-freshness.ts [slug]
 */
import { createClient } from "@supabase/supabase-js";

const SLUG = process.argv[2] ?? "varble";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const SOCIAL_PLATFORMS = ["meta_facebook", "meta_instagram", "youtube", "tiktok", "linkedin"] as const;

function ago(ts: string | null | undefined): string {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  const h = ms / 36e5;
  if (h < 1) return `${Math.round(ms / 6e4)}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

async function count(table: string, filter: Record<string, string>): Promise<number> {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { count: c, error } = await q;
  if (error) { console.error(`  ! count(${table}) failed: ${error.message}`); return -1; }
  return c ?? 0;
}

async function extreme(
  table: string, col: string, dir: "asc" | "desc", filter: Record<string, string>,
): Promise<string | null> {
  let q = sb.from(table).select(col).order(col, { ascending: dir === "asc" }).limit(1);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) { console.error(`  ! ${dir}(${table}.${col}) failed: ${error.message}`); return null; }
  return (data?.[0] as unknown as Record<string, string> | undefined)?.[col] ?? null;
}

async function main() {
  console.log(`\n══════ FRESHNESS AUDIT — client slug "${SLUG}" — now=${new Date().toISOString()} ══════\n`);

  // 1) Client row
  const { data: client, error: cErr } = await sb
    .from("clients").select("id, slug, name, status, timezone, created_at").eq("slug", SLUG).maybeSingle();
  if (cErr || !client) { console.error(`No client with slug "${SLUG}": ${cErr?.message ?? "not found"}`); process.exit(1); }
  const id = client.id as string;
  console.log(`CLIENT  ${client.name}  (status=${client.status}, tz=${client.timezone})`);
  console.log(`        id=${id}\n`);

  // 2) Ads + GHL credential config (presence only — never the secret ids)
  const { data: creds } = await sb.from("client_credentials")
    .select("meta_ad_account_id, meta_result_type, meta_access_token_secret_id, ghl_location_id, ghl_pipeline_id, ghl_token_secret_id, updated_at")
    .eq("client_id", id).maybeSingle();
  console.log("── Ads / GHL credentials ──");
  if (!creds) console.log("  (no client_credentials row)");
  else {
    console.log(`  Meta: ad_account=${creds.meta_ad_account_id ?? "—"}  result_type=${creds.meta_result_type}  token=${creds.meta_access_token_secret_id ? "set" : "MISSING"}`);
    console.log(`  GHL : location=${creds.ghl_location_id ?? "—"}  pipeline=${creds.ghl_pipeline_id ?? "—"}  token=${creds.ghl_token_secret_id ? "set" : "MISSING"}`);
  }

  // 3) Connected social platforms (display names only)
  const { data: socialCreds } = await sb.from("client_social_credentials")
    .select("platform, fb_page_name, ig_username, youtube_channel_title, tiktok_username, tiktok_display_name, updated_at")
    .eq("client_id", id);
  console.log("\n── Connected socials ──");
  if (!socialCreds?.length) console.log("  (none connected)");
  for (const s of socialCreds ?? []) {
    const label = s.fb_page_name ?? s.youtube_channel_title ?? s.tiktok_display_name ?? s.tiktok_username ?? "";
    const ig = s.ig_username ? `  +IG @${s.ig_username}` : "";
    console.log(`  ${String(s.platform).padEnd(10)} ${label}${ig}   (updated ${ago(s.updated_at)})`);
  }

  // 4) etl_runs — latest per source
  console.log("\n── etl_runs (latest per source) ──");
  const sources = ["meta_daily", "meta_backfill", "ghl_full", "social_daily", "social_backfill", "social_posts"];
  for (const src of sources) {
    const { data } = await sb.from("etl_runs")
      .select("status, started_at, finished_at, rows_written, error_message")
      .eq("client_id", id).eq("source", src).order("started_at", { ascending: false }).limit(1);
    const r = data?.[0];
    if (!r) { console.log(`  ${src.padEnd(16)} — never run`); continue; }
    const err = r.error_message ? `  ERR: ${String(r.error_message).slice(0, 80)}` : "";
    console.log(`  ${src.padEnd(16)} ${String(r.status).padEnd(8)} ${ago(r.started_at).padEnd(8)} rows=${r.rows_written ?? "—"}${err}`);
  }

  // 5) meta_daily
  console.log("\n── meta_daily ──");
  const md = await count("meta_daily", { client_id: id });
  console.log(`  rows=${md}  days ${await extreme("meta_daily", "day", "asc", { client_id: id })} → ${await extreme("meta_daily", "day", "desc", { client_id: id })}  lastFetched=${ago(await extreme("meta_daily", "fetched_at", "desc", { client_id: id }))}`);

  // 6) ghl_opportunities
  console.log("\n── ghl_opportunities ──");
  const go = await count("ghl_opportunities", { client_id: id });
  console.log(`  rows=${go}  newestOpp=${await extreme("ghl_opportunities", "created_at_ghl", "desc", { client_id: id })}  lastFetched=${ago(await extreme("ghl_opportunities", "fetched_at", "desc", { client_id: id }))}`);

  // 7) social_daily_metrics — per platform
  console.log("\n── social_daily_metrics (per platform) ──");
  for (const p of SOCIAL_PLATFORMS) {
    const n = await count("social_daily_metrics", { client_id: id, platform: p });
    if (n <= 0) { console.log(`  ${p.padEnd(15)} rows=${n}`); continue; }
    const lo = await extreme("social_daily_metrics", "day", "asc", { client_id: id, platform: p });
    const hi = await extreme("social_daily_metrics", "day", "desc", { client_id: id, platform: p });
    const f = await extreme("social_daily_metrics", "fetched_at", "desc", { client_id: id, platform: p });
    console.log(`  ${p.padEnd(15)} rows=${String(n).padEnd(5)} days ${lo} → ${hi}  lastFetched=${ago(f)}`);
  }

  // 8) social_posts — per platform
  console.log("\n── social_posts (per platform) ──");
  for (const p of SOCIAL_PLATFORMS) {
    const n = await count("social_posts", { client_id: id, platform: p });
    if (n <= 0) { console.log(`  ${p.padEnd(15)} rows=${n}`); continue; }
    const newest = await extreme("social_posts", "posted_at", "desc", { client_id: id, platform: p });
    const f = await extreme("social_posts", "fetched_at", "desc", { client_id: id, platform: p });
    console.log(`  ${p.padEnd(15)} rows=${String(n).padEnd(5)} newestPost=${newest}  lastFetched=${ago(f)}`);
  }

  // 9) social_backfill_jobs — latest per platform
  console.log("\n── social_backfill_jobs (latest per platform) ──");
  for (const p of SOCIAL_PLATFORMS) {
    const { data } = await sb.from("social_backfill_jobs")
      .select("status, earliest_day, latest_day, rows_written, error, updated_at")
      .eq("client_id", id).eq("platform", p).order("updated_at", { ascending: false }).limit(1);
    const r = data?.[0];
    if (!r) continue;
    const err = r.error ? `  ERR: ${String(r.error).slice(0, 80)}` : "";
    console.log(`  ${p.padEnd(15)} ${String(r.status).padEnd(8)} ${r.earliest_day} → ${r.latest_day}  rows=${r.rows_written}  (${ago(r.updated_at)})${err}`);
  }

  console.log("\n══════ END ══════\n");
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
