/**
 * READ-ONLY: preview the impact of the Meta-source lead filter (migration 031)
 * before applying it. For each client, applies the SAME predicate the SQL
 * is_meta_lead() / TS isMetaLead() use (source starts with "meta", case-
 * insensitive) and reports how many leads are kept vs dropped.
 *
 * SELECT-only. No writes, no PII. Safe on prod.
 * Usage: npx tsx --env-file=.env.local scripts/probe-meta-filter-impact.ts
 */
import { createClient } from "@supabase/supabase-js";
import { isMetaLead } from "../src/lib/meta-source";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// Clients we plan to opt OUT of the filter (ads_meta_source_only = false).
const OPTED_OUT = new Set(["stl-sports-clinic"]);

async function main() {
  const { data: clients, error } = await sb
    .from("clients")
    .select("id, slug, name")
    .order("slug");
  if (error) throw error;

  for (const c of clients ?? []) {
    let total = 0;
    let kept = 0;
    let from = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error: e } = await sb
        .from("ghl_opportunities")
        .select("source")
        .eq("client_id", c.id)
        .range(from, from + PAGE - 1);
      if (e) throw e;
      if (!data || data.length === 0) break;
      for (const row of data) {
        total++;
        if (isMetaLead((row as { source: string | null }).source)) kept++;
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
    if (total === 0) continue;

    const optedOut = OPTED_OUT.has(c.slug);
    const dropped = total - kept;
    const keepPct = ((kept / total) * 100).toFixed(1);
    const effective = optedOut
      ? `OPT-OUT → keeps all ${total} (filter not applied)`
      : `keeps ${kept}/${total} (${keepPct}%), drops ${dropped}`;
    console.log(`${c.slug.padEnd(22)} ${effective}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
