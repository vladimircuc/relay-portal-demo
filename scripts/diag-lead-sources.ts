// READ-ONLY: dump GHL opportunity `source` + `tags` distributions for a few
// clients, to find a reliable "website vs ads" lead signal.
//   npx tsx --env-file=.env.local scripts/diag-lead-sources.ts
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const NEEDLES = ["lts", "varble", "stl", "ballwin"];

function top(map: Map<string, number>, n = 25): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

(async () => {
  const { data: clients } = await sb
    .from("clients")
    .select("id,name,slug,ads_meta_source_only,enabled_services");
  const targets = (clients ?? []).filter((c) =>
    NEEDLES.some((nd) => c.slug.toLowerCase().includes(nd) || c.name.toLowerCase().includes(nd)),
  );

  console.log("\nMatched clients:", targets.map((c) => `${c.name} (${c.slug})`).join(", ") || "NONE");

  for (const c of targets) {
    const { data: opps } = await sb
      .from("ghl_opportunities")
      .select("source,tags")
      .eq("client_id", c.id)
      .limit(20000);
    const rows = opps ?? [];
    const src = new Map<string, number>();
    const tags = new Map<string, number>();
    let meta = 0;
    for (const o of rows as Array<{ source: string | null; tags: string[] | null }>) {
      const s = o.source ?? "(null)";
      src.set(s, (src.get(s) ?? 0) + 1);
      if (o.source && o.source.trimStart().toLowerCase().startsWith("meta")) meta++;
      for (const t of o.tags ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
    }
    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log(`${c.name}  [${c.slug}]   opps=${rows.length}   ads_meta_source_only=${c.ads_meta_source_only}   services=${JSON.stringify(c.enabled_services)}`);
    console.log(`  meta-source leads (source starts "meta"): ${meta}  |  non-meta: ${rows.length - meta}`);
    console.log(`  --- SOURCE values (count) ---`);
    for (const [k, v] of top(src)) console.log(`     ${String(v).padStart(5)}  ${k}`);
    console.log(`  --- TAGS (count) ---`);
    if (tags.size === 0) console.log("     (no tags on any opp)");
    else for (const [k, v] of top(tags)) console.log(`     ${String(v).padStart(5)}  ${k}`);
  }
  console.log();
})();
