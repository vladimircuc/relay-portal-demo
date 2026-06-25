/**
 * READ-ONLY probe: what do ghl_opportunities.source values actually look like,
 * per client? Needed to design a "count only Meta-sourced leads" filter — we
 * must know the real string format (does Meta tag as "meta…", "Facebook…",
 * "Instagram…", "fb…"?) before writing a predicate.
 *
 * SELECT-only. Prints source strings + counts only (no PII). Safe on prod.
 * Usage: npx tsx --env-file=.env.local scripts/probe-lead-sources.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: clients, error: cErr } = await sb
    .from("clients")
    .select("id, slug, name")
    .order("slug");
  if (cErr) throw cErr;

  for (const c of clients ?? []) {
    // Pull just the source column for this client (paginate to be safe).
    const counts = new Map<string, number>();
    let total = 0;
    let from = 0;
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await sb
        .from("ghl_opportunities")
        .select("source")
        .eq("client_id", c.id)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const row of data) {
        const raw = (row as { source: string | null }).source;
        const key = raw === null ? "<NULL>" : raw === "" ? "<EMPTY>" : raw;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total++;
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }

    if (total === 0) continue;

    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\n=== ${c.slug} (${c.name}) — ${total} opps, ${ranked.length} distinct sources ===`);
    for (const [src, n] of ranked) {
      const pct = ((n / total) * 100).toFixed(1).padStart(5);
      console.log(`  ${pct}%  ${String(n).padStart(5)}  ${src}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
