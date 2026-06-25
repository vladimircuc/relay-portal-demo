/**
 * READ-ONLY verification of the Web & SEO split (migrations 037 + 038).
 * Confirms: every client that had `seo` now also has `web` (seo ⟹ web), no
 * client has seo-without-web, and no per-user scope still carries the legacy
 * `seo` (all remapped to `web`).
 *
 * SELECT-only and PII-free: it reads client slugs (URL identifiers) + the
 * enabled_services / scopes arrays only — NO emails or other personal data.
 *
 * Usage: npx tsx --env-file=.env.local scripts/verify-web-seo.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: clients, error: cErr } = await sb
    .from("clients")
    .select("slug, enabled_services")
    .order("slug");
  if (cErr) throw cErr;

  console.log("=== clients.enabled_services ===");
  let seoWithoutWeb = 0;
  for (const c of clients ?? []) {
    const svc: string[] = (c as { enabled_services?: string[] }).enabled_services ?? [];
    const bad = svc.includes("seo") && !svc.includes("web");
    if (bad) seoWithoutWeb++;
    console.log(`  ${(c as { slug: string }).slug.padEnd(28)} [${svc.join(", ")}]${bad ? "   ⚠️ seo WITHOUT web" : ""}`);
  }

  // Scopes only — NO email column selected (avoid pulling PII into output).
  const { data: grants, error: gErr } = await sb
    .from("client_allowed_emails")
    .select("scopes")
    .not("scopes", "is", null);
  if (gErr) throw gErr;

  let leftoverSeoScope = 0;
  const scopeShapes = new Map<string, number>();
  for (const g of grants ?? []) {
    const scopes: string[] = (g as { scopes?: string[] }).scopes ?? [];
    if (scopes.includes("seo")) leftoverSeoScope++;
    const k = `[${[...scopes].sort().join(", ")}]`;
    scopeShapes.set(k, (scopeShapes.get(k) ?? 0) + 1);
  }
  console.log("\n=== scoped grants — scope-array shapes (counts, no emails) ===");
  if (scopeShapes.size === 0) console.log("  (no scoped grants — all viewers / unscoped)");
  for (const [shape, n] of scopeShapes) console.log(`  ${n}× ${shape}`);

  console.log("\n=== summary ===");
  console.log(`  clients with seo-without-web (should be 0): ${seoWithoutWeb}`);
  console.log(`  scopes still carrying 'seo' (should be 0):   ${leftoverSeoScope}`);
  console.log(seoWithoutWeb === 0 && leftoverSeoScope === 0 ? "  ✅ data state correct" : "  ⚠️ see warnings above");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
