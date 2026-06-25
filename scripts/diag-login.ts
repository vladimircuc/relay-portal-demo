/**
 * READ-ONLY login diagnostic. SELECT-only; prints no tokens/secrets.
 *   npx tsx --env-file=.env.local scripts/diag-login.ts <email>
 *
 * Tells us:
 *   - whether the magic-link request reached Supabase (auth user exists, when
 *     created, last sign-in, email confirmed) → if it exists, the send was
 *     attempted server-side and the problem is DELIVERY (SMTP/spam/rate-limit).
 *   - whether the email's domain / address is mapped to an ACTIVE client (so
 *     once they get the link, they won't dead-end on /no-access).
 */
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] ?? "").toLowerCase().trim();
if (!email) { console.error("usage: tsx scripts/diag-login.ts <email>"); process.exit(1); }
const domain = email.split("@")[1] ?? "";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE env"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

function when(ts: string | null | undefined): string {
  if (!ts) return "—";
  const h = (Date.now() - new Date(ts).getTime()) / 36e5;
  const rel = h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  return `${ts} (${rel} ago)`;
}

(async () => {
  console.log(`\n=== LOGIN DIAGNOSTIC for ${email} ===\n`);

  // 1) Auth user — did the OTP request reach Supabase?
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) console.log("auth.admin.listUsers error:", error.message);
  const u = data?.users.find((x) => x.email?.toLowerCase() === email);
  if (u) {
    console.log("AUTH USER: FOUND ✓  (so the magic-link request DID reach Supabase)");
    console.log("  created_at:      ", when(u.created_at));
    console.log("  last_sign_in_at: ", when(u.last_sign_in_at));
    console.log("  email_confirmed: ", u.email_confirmed_at ? "yes" : "no (never clicked a link)");
    console.log("  → user exists but no email arrived ⇒ DELIVERY problem (SMTP / spam / rate limit).");
  } else {
    console.log("AUTH USER: NOT FOUND ✗  (no user with this email)");
    console.log("  → the OTP request may never have reached Supabase, OR users are pruned.");
  }

  // 2) Access mapping — will they get in once they click the link?
  console.log("\n--- ACCESS MAPPING ---");
  const { data: dom } = await sb
    .from("client_domains")
    .select("email_domain, clients!inner(name, slug, status)")
    .eq("email_domain", domain);
  const { data: allow } = await sb
    .from("client_allowed_emails")
    .select("email, role, clients!inner(name, slug, status)")
    .eq("email", email);

  if (dom?.length) {
    for (const r of dom as unknown as Array<{ email_domain: string; clients: { name: string; slug: string; status: string } }>)
      console.log(`  domain  ${r.email_domain} → ${r.clients?.name} (${r.clients?.slug}) [${r.clients?.status}]`);
  } else {
    console.log(`  domain  ${domain} → NOT mapped to any client`);
  }
  if (allow?.length) {
    for (const r of allow as unknown as Array<{ email: string; role: string; clients: { name: string; slug: string; status: string } }>)
      console.log(`  email   ${r.email} → ${r.clients?.name} (${r.clients?.slug}) [${r.clients?.status}] role=${r.role}`);
  } else {
    console.log(`  email   ${email} → NOT in client_allowed_emails`);
  }

  // 3) Is there a Ballwin client at all (by name) for context?
  const { data: maybe } = await sb
    .from("clients")
    .select("name, slug, status")
    .ilike("name", `%${(domain.split(".")[0] || "").slice(0, 6)}%`);
  console.log("\n--- clients whose name ~ matches the domain ---");
  for (const c of (maybe ?? []) as Array<{ name: string; slug: string; status: string }>)
    console.log(`  ${c.name} (${c.slug}) [${c.status}]`);
  if (!maybe?.length) console.log("  (none)");
  console.log();
})();
