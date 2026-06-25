/**
 * READ-ONLY probe: does GHL's opportunity payload carry a "lost reason"?
 *
 * We already store the FULL, unmodified GHL /opportunities/search payload in
 * ghl_opportunities.raw (jsonb). So we can answer "does the API give us a lost
 * reason" without any live API call or token decrypt — just inspect raw for the
 * client's already-pulled lost opps.
 *
 * Prints, for the given client slug (default "varble"):
 *   - status distribution (confirm 'lost' is used + how many)
 *   - union of ALL deep key PATHS across lost opps (names only — no PII)
 *   - any path whose key matches /lost|reason/i, WITH sample scalar values
 *   - a peek at customFields shape (GHL often stores extras as opaque {id,value})
 *
 * SELECT-only. Prints no tokens / secret ids / contact PII (only key names +
 * lost-reason text, which isn't sensitive). Safe on prod.
 * Usage: npx tsx --env-file=.env.local scripts/probe-ghl-lost-reason.ts [slug]
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

/** Collect every dotted path in an object (array indices collapsed to []). */
function collectPaths(obj: unknown, path: string, out: Set<string>) {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    if (obj.length === 0) out.add(`${path}[]`);
    obj.forEach((v) => collectPaths(v, `${path}[]`, out));
    return;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      out.add(p);
      collectPaths(v, p, out);
    }
  }
}

/** Find paths whose final key matches /lost|reason/i, with sample scalar values. */
function scanForReason(obj: unknown, path: string, hits: Map<string, Set<string>>) {
  if (obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    obj.forEach((v) => scanForReason(v, `${path}[]`, hits));
    return;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      if (/lost|reason/i.test(k)) {
        if (!hits.has(p)) hits.set(p, new Set());
        const set = hits.get(p)!;
        if (v !== null && v !== undefined && typeof v !== "object" && set.size < 10) {
          set.add(String(v));
        }
      }
      scanForReason(v, p, hits);
    }
  }
}

async function main() {
  const { data: client } = await sb
    .from("clients").select("id, name, status").eq("slug", SLUG).maybeSingle();
  if (!client) {
    const { data: all } = await sb.from("clients").select("slug, name").order("slug");
    console.error(`No client "${SLUG}". Available slugs:`);
    for (const c of all ?? []) console.error(`  ${String(c.slug).padEnd(24)} ${c.name}`);
    process.exit(1);
  }
  const id = client.id as string;
  console.log(`\n══ GHL lost-reason probe — client "${SLUG}" (${client.name}, status=${client.status}) ══\n`);

  // 1) status distribution across ALL opps
  const { data: allRows, error: allErr } = await sb
    .from("ghl_opportunities").select("status").eq("client_id", id);
  if (allErr) { console.error("status query failed:", allErr.message); process.exit(1); }
  const statusCounts = new Map<string, number>();
  for (const r of allRows ?? []) {
    const s = (r.status as string | null) ?? "(null)";
    statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
  }
  console.log("── status distribution (all opps) ──");
  for (const [s, n] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(12)} ${n}`);
  }

  // 2) pull raw for lost opps (cap 500 — plenty for a structural probe)
  const { data: lost, error: lostErr } = await sb
    .from("ghl_opportunities").select("raw")
    .eq("client_id", id).eq("status", "lost").limit(500);
  if (lostErr) { console.error("lost query failed:", lostErr.message); process.exit(1); }
  const lostRows = lost ?? [];

  const allPaths = new Set<string>();
  const reasonHits = new Map<string, Set<string>>();
  let withRaw = 0;
  let sampleCustomFields: unknown = undefined;
  for (const r of lostRows) {
    const raw = r.raw as Record<string, unknown> | null;
    if (!raw) continue;
    withRaw++;
    collectPaths(raw, "", allPaths);
    scanForReason(raw, "", reasonHits);
    if (sampleCustomFields === undefined && "customFields" in raw) {
      sampleCustomFields = (raw as Record<string, unknown>).customFields;
    }
  }
  console.log(`\n── lost opps sampled: ${lostRows.length} (with non-null raw: ${withRaw}) ──`);

  console.log("\n── ALL deep key paths seen on lost opps (names only) ──");
  console.log("  " + [...allPaths].sort().join("\n  "));

  console.log("\n── paths matching /lost|reason/i ──");
  if (reasonHits.size === 0) {
    console.log("  *** NONE — GHL search payload carries no lost-reason field for this client. ***");
  } else {
    for (const [p, vals] of reasonHits) {
      console.log(`  ${p}`);
      console.log(vals.size ? `      values: ${[...vals].join(" | ")}` : `      (present but object/empty — no scalar sample)`);
    }
  }

  if (sampleCustomFields !== undefined) {
    console.log("\n── sample customFields shape (one lost opp) ──");
    console.log("  " + JSON.stringify(sampleCustomFields).slice(0, 600));
  }
  console.log();
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
