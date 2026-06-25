// READ-ONLY GSC access diagnostic.
//   npx tsx --env-file=.env.local scripts/diag-gsc.ts [client-slug]
// Prints the service-account email, the client's configured gsc_site_url, and
// EVERY Search Console property the service account can actually read.
import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";

const slug = process.argv[2] ?? "rob-harris-photography";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const b64 = process.env.GOOGLE_SA_KEY_B64!;
const subject = process.env.GOOGLE_SUBJECT || undefined;

(async () => {
  const sa = JSON.parse(Buffer.from(b64, "base64").toString());
  console.log("\n=== GSC ACCESS DIAGNOSTIC ===");
  console.log("Service-account email (THIS is what Kris must add):", sa.client_email);
  console.log("Impersonation subject (GOOGLE_SUBJECT):", subject ?? "(none — acts as the service account itself)");

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: client } = await sb.from("clients").select("id,name,slug").eq("slug", slug).maybeSingle();
  let configured: string | null = null;
  if (client) {
    const { data: cfg } = await sb
      .from("client_seo_config")
      .select("gsc_site_url, ga4_property_id, bing_site_url")
      .eq("client_id", client.id)
      .maybeSingle();
    configured = (cfg?.gsc_site_url as string | undefined) ?? null;
    console.log(`\nClient: ${client.name} (${client.slug})`);
    console.log("Configured gsc_site_url:", configured ?? "(none set)");
  } else {
    console.log(`\nNo client found with slug "${slug}".`);
  }

  const auth = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    subject,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  let sites: { siteUrl: string; permissionLevel: string }[] = [];
  try {
    const { data } = await auth.request<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>({
      url: "https://searchconsole.googleapis.com/webmasters/v3/sites",
    });
    sites = data.siteEntry ?? [];
  } catch (e) {
    console.log("\nsites.list FAILED:", e instanceof Error ? e.message : String(e));
    return;
  }

  console.log(`\nSearch Console properties this principal CAN access (${sites.length}):`);
  for (const s of sites.sort((a, b) => a.siteUrl.localeCompare(b.siteUrl)))
    console.log(`  ${s.permissionLevel.padEnd(18)} ${s.siteUrl}`);

  if (configured) {
    const has = sites.some((s) => s.siteUrl === configured);
    console.log(`\n→ Configured site "${configured}" in the accessible list? ${has ? "YES ✓ (access OK)" : "NO ✗ (this is the error)"}`);
    if (!has) {
      const bare = configured.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
      const apex = bare.split(".").slice(-2).join(".");
      const related = sites.filter((s) => s.siteUrl.toLowerCase().includes(apex));
      console.log(`  Other properties for "${apex}" the SA CAN see:`);
      if (related.length) related.forEach((s) => console.log(`    ${s.permissionLevel} ${s.siteUrl}`));
      else console.log("    (NONE — the service account isn't on any property for this domain at all)");
    }
  }
  console.log();
})();
