/**
 * One-shot diagnostic: fetch a recent Meta insights row for a client
 * and report which fields are non-null/non-zero. The token stays in
 * process and is NEVER printed.
 *
 * Run:
 *   cd dashboard/web
 *   pnpm tsx scripts/diagnose-meta-insights.ts <clientId> <since> <until>
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";
import { fetchMetaInsights } from "../src/lib/etl/meta-api";

async function main() {
  const [clientId, since, until] = process.argv.slice(2);
  if (!clientId || !since || !until) {
    console.error("usage: diagnose-meta-insights.ts <clientId> <since> <until>");
    process.exit(1);
  }

  const supabase = createAdminClient();
  const { data: creds, error } = await supabase
    .from("client_credentials")
    .select("meta_access_token_secret_id, meta_ad_account_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !creds) throw new Error("No creds: " + error?.message);

  const token = await getVaultSecret(supabase, creds.meta_access_token_secret_id!);
  console.log("Ad account:", creds.meta_ad_account_id);
  console.log("Range:", since, "→", until);

  const insights = await fetchMetaInsights({
    token,
    adAccountId: creds.meta_ad_account_id!,
    since,
    until,
  });

  console.log("\nReceived", insights.length, "insight rows.");
  if (insights.length === 0) return;

  // Print field-level summary — NOT the token.
  const first = insights[0];
  console.log("\n=== First insight, field-by-field ===");
  for (const [k, v] of Object.entries(first)) {
    if (k === "actions" || k === "cost_per_action_type") {
      console.log(`  ${k}: ${Array.isArray(v) ? v.length + " entries" : v}`);
    } else {
      console.log(`  ${k}: ${JSON.stringify(v)}  (typeof ${typeof v})`);
    }
  }

  // Aggregate over all rows: how many have non-zero spend/impressions/etc?
  console.log("\n=== Across all", insights.length, "rows ===");
  const fields = ["spend", "impressions", "reach", "inline_link_clicks", "cpm", "cpc", "ctr", "frequency"];
  for (const f of fields) {
    const vals = insights.map((i) => (i as Record<string, unknown>)[f]);
    const nonZero = vals.filter((v) => Number(v) > 0).length;
    const sumNum = vals.reduce((a: number, v) => a + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
    console.log(`  ${f}: ${nonZero}/${insights.length} non-zero rows, sum=${sumNum}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
