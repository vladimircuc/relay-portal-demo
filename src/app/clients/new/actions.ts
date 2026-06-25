"use server";

/**
 * Server action for creating a new client row.
 *
 * Super-admin only. Validates slug shape + uniqueness, validates timezone
 * against the runtime's IANA list, captures which products the client is
 * entitled to (enabled_services), and optionally seeds the initial access
 * list (allowed domains + local admins). On success, redirects the
 * super-admin to /<slug>/admin so they can finish the setup checklist
 * (credentials, pipeline, first ETL).
 *
 * What the create flow DOES set:
 *   - enabled_services: which products (Ads / Socials) this client gets.
 *     This is the single source of truth that drives which dashboard tabs
 *     render and which /admin capability tabs can be managed.
 *   - client_domains: optional email domains whose users may VIEW the
 *     client (always viewer-level — domains never grant elevated rights).
 *   - client_allowed_emails: optional per-email access grants — each either
 *     a viewer (read-only) or a local super-admin with chosen capability
 *     scopes (Ads / Socials), mirroring the Settings → Access section.
 *
 * What it deliberately does NOT set (handled later on /admin):
 *   - Ads config (credentials, pipeline, funnel labels/goals, revenue).
 *   - Socials: nothing to pre-configure — accounts are connected via OAuth.
 *   - Logo upload stays optional (URL or null; PNG drop-in is separate).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireGlobalSuperAdmin, type Capability, type Service } from "@/lib/auth";
import { isPublicEmailProvider } from "@/lib/email-domains";
import { assertWritable } from "@/lib/demo";

/**
 * Reserved app slugs — must match the set used in the route guards
 * (clientSlug page.tsx, admin page.tsx). Keep these in sync or a newly
 * created client could clash with an existing app route and render as a
 * 404 to its own users.
 */
const RESERVED_SLUGS = new Set([
  "login", "logout", "auth", "no-access", "clients", "api", "admin", "favicon.ico",
]);

/**
 * Coerce a free-form slug input to kebab-case lowercase ASCII. Strips
 * anything that isn't [a-z0-9-], collapses runs of dashes, trims leading
 * and trailing dashes.
 *
 * Examples:
 *   "Varble Orthodontics" → "varble-orthodontics"
 *   "Smith & Co."         → "smith-co"
 *   "  hello--world  "    → "hello-world"
 */
function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True when the given string is a valid IANA timezone in this runtime. */
function isValidTimezone(tz: string): boolean {
  try {
    // Throws RangeError on an unknown timezone identifier.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** True when the given string is a 3- or 6-char hex color (with leading #). */
function isValidHexColor(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

/**
 * Accept only a safe brand logo value: empty, a same-origin relative path, or an
 * https URL. Rejects javascript:/data:/file: and protocol-relative URLs so a
 * hand-crafted POST can't smuggle a hostile value into a field the report
 * renderer later fetches server-side (egress is additionally guarded at fetch
 * time in api/report — see inlineImage).
 */
function isAllowedLogoUrl(raw: string): boolean {
  if (raw === "") return true;
  if (raw.startsWith("/") && !raw.startsWith("//")) return true; // same-origin relative
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

// ── Access-list parsing (mirrors components/admin/access-actions.ts) ──────────

/** Split a free-form list (commas / whitespace / newlines) into tokens. */
function splitList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Strip an accidentally-pasted "user@" prefix and lowercase a domain. */
function cleanDomain(raw: string): string {
  const stripped = raw.includes("@") ? raw.split("@").pop()! : raw;
  return stripped.trim().toLowerCase();
}

function isDomainLike(d: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d);
}

function cleanEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isEmailLike(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Read the chosen products from the form. The form sends one `enabled_services`
 * checkbox per service (value "ads" / "socials" / "web" / "seo"). Filtered to
 * known services + de-duped, preserving canonical order. Enforces seo ⟹ web
 * (the SEO upsell always rides on the Web base).
 */
function parseServicesFromForm(formData: FormData): Service[] {
  const raw = formData.getAll("enabled_services").map(String);
  const set = new Set(raw.filter((s): s is Service => s === "ads" || s === "socials" || s === "web" || s === "seo"));
  if (set.has("seo")) set.add("web");
  // Canonical order so the stored array is stable regardless of click order.
  return (["ads", "socials", "web", "seo"] as const).filter((c) => set.has(c));
}

/** One seeded access grant from the LocalAdminsField. */
type LocalAdminEntry = {
  email: string;
  role: "viewer" | "local_super_admin";
  /** Only meaningful for local_super_admin; ignored (stored null) for viewer. */
  scopes: Capability[];
};

/**
 * Decode the `local_admins` hidden input — a JSON array of {email, role,
 * scopes} rows posted by the LocalAdminsField client component. Defensive at
 * every step (the field is JS-built, but we never trust the wire): non-array
 * input, malformed rows, and unknown roles/scopes are dropped, emails are
 * cleaned + de-duped (first occurrence wins). Mirrors the per-row contract
 * the Settings → Access add-email form enforces server-side.
 */
function parseLocalAdmins(raw: string): LocalAdminEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: LocalAdminEntry[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const email = cleanEmail(typeof obj.email === "string" ? obj.email : "");
    if (!email || seen.has(email)) continue;
    const role: LocalAdminEntry["role"] =
      obj.role === "local_super_admin" ? "local_super_admin" : "viewer";
    const scopesRaw: unknown[] = Array.isArray(obj.scopes) ? obj.scopes : [];
    // Forward-map legacy "seo" scope → unified "web" (Web & SEO) capability.
    const scopeSet = new Set(scopesRaw.map((s) => (s === "seo" ? "web" : s)));
    const scopes = (["ads", "socials", "web"] as const).filter((c) => scopeSet.has(c));
    seen.add(email);
    out.push({ email, role, scopes });
  }
  return out;
}

/**
 * The shape returned by `createClient` when validation fails. The form
 * page reads `error` to render an inline message; on success we don't
 * return at all (we redirect, which throws NEXT_REDIRECT).
 */
export type CreateClientResult = {
  error?: string;
  /** Form values to re-populate inputs after a validation failure. */
  values?: {
    name: string;
    slug: string;
    timezone: string;
    brand_accent_color: string;
    brand_logo_url: string;
    funnel_label_booking: string;
    funnel_label_show: string;
    /** Products ticked on the failed attempt, so the boxes stay checked. */
    enabled_services: Service[];
    /** Raw text of the allowed-domains input, echoed verbatim. */
    allowed_domains: string;
    /** JSON-encoded local-admin rows (email + role + scopes), echoed verbatim. */
    local_admins: string;
  };
};

export async function createClient(
  _prev: CreateClientResult | null,
  formData: FormData,
): Promise<CreateClientResult> {
  assertWritable("Create client");
  await requireGlobalSuperAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("slug") ?? "");
  const timezone = String(formData.get("timezone") ?? "").trim();
  const brand_accent_color = String(formData.get("brand_accent_color") ?? "").trim();
  const brand_logo_url = String(formData.get("brand_logo_url") ?? "").trim();
  const allowed_domains = String(formData.get("allowed_domains") ?? "");
  const local_admins = String(formData.get("local_admins") ?? "");

  const enabledServices = parseServicesFromForm(formData);

  // Custom labels for the middle two funnel stages (Booking + Show). The
  // first + last stages (Lead + Conversion) are universal across all
  // clients and hardcoded in the dashboard — no input here. Empty input
  // falls back to the canonical default rather than being stored as an
  // empty string, so the dashboard always has something to render.
  const funnel_label_booking =
    String(formData.get("funnel_label_booking") ?? "").trim() || "Booking";
  const funnel_label_show =
    String(formData.get("funnel_label_show") ?? "").trim() || "Show";

  const values = {
    name,
    slug: slugRaw,
    timezone,
    brand_accent_color,
    brand_logo_url,
    funnel_label_booking,
    funnel_label_show,
    enabled_services: enabledServices,
    allowed_domains,
    local_admins,
  };

  // ── Validation ───────────────────────────────────────────────────────────

  if (name.length < 2) {
    return { error: "Name must be at least 2 characters.", values };
  }

  const slug = normalizeSlug(slugRaw || name);
  if (slug.length < 2) {
    return { error: "Slug must be at least 2 characters (a–z, 0–9, dashes).", values };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { error: `"${slug}" is a reserved slug. Pick another.`, values };
  }

  if (!isValidTimezone(timezone)) {
    return { error: `"${timezone}" isn't a valid IANA timezone.`, values };
  }

  // Every client must have at least one product — an entitlement of {} would
  // render a dashboard with only the Home tab and nothing to manage.
  if (enabledServices.length === 0) {
    return { error: "Pick at least one service (Ads / Socials).", values };
  }

  // Hex is optional — fall back to brand yellow if blank, otherwise validate.
  const accent = brand_accent_color || "#ff6a00";
  if (!isValidHexColor(accent)) {
    return {
      error: `"${brand_accent_color}" isn't a valid hex color (e.g. #ff6a00).`,
      values,
    };
  }

  if (!isAllowedLogoUrl(brand_logo_url)) {
    return { error: "Logo URL must be empty, an uploaded image path, or an https URL.", values };
  }

  // Parse + shape-validate the optional access lists BEFORE creating the
  // client, so a typo'd domain/email fails up-front instead of leaving a
  // half-seeded client behind. De-dupe so the same entry typed twice is one
  // row.
  const domains = Array.from(new Set(splitList(allowed_domains).map(cleanDomain)));
  const badDomain = domains.find((d) => !isDomainLike(d));
  if (badDomain) {
    return { error: `"${badDomain}" doesn't look like a valid domain.`, values };
  }
  const publicProviderDomain = domains.find(isPublicEmailProvider);
  if (publicProviderDomain) {
    return {
      error: `"${publicProviderDomain}" is a public email provider — use the per-email allowlist, not a domain rule.`,
      values,
    };
  }

  const localAdmins = parseLocalAdmins(local_admins);
  const badAdmin = localAdmins.find((a) => !isEmailLike(a.email));
  if (badAdmin) {
    return { error: `"${badAdmin.email}" doesn't look like a valid email.`, values };
  }
  // A local super-admin grant must name ≥1 capability scope (a viewer carries
  // null scopes). Re-validates the LocalAdminsField's own inline check so a
  // hand-crafted POST can't seed a scope-less local super-admin.
  const unscopedLsa = localAdmins.find(
    (a) => a.role === "local_super_admin" && a.scopes.length === 0,
  );
  if (unscopedLsa) {
    return {
      error: `Pick at least one service (Ads / Socials) for ${unscopedLsa.email}, or set them to Viewer.`,
      values,
    };
  }

  const supabase = createAdminClient();

  // Uniqueness check up-front so we can return a nicer message than the
  // raw Postgres unique-violation error.
  const { data: existing } = await supabase
    .from("clients")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    return { error: `Slug "${slug}" is already in use.`, values };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("clients")
    .insert({
      slug,
      name,
      timezone,
      brand_accent_color: accent,
      // null when blank so the ClientLogo fallback (initial + accent color)
      // renders cleanly instead of trying to load an empty src.
      brand_logo_url: brand_logo_url || null,
      status: "active",
      funnel_label_booking,
      funnel_label_show,
      // The products this client gets — drives tabs, Home copy, and which
      // /admin capability tabs are manageable.
      enabled_services: enabledServices,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { error: insertError?.message ?? "Failed to create client.", values };
  }

  const clientId = inserted.id as string;

  // Seed the optional access list. Best-effort + idempotent: unique
  // violations (23505) are swallowed so a re-submit after a partial failure
  // doesn't error, and the super-admin can always review/fix on /admin next.
  for (const email_domain of domains) {
    const { error } = await supabase
      .from("client_domains")
      .insert({ client_id: clientId, email_domain });
    if (error && error.code !== "23505") {
      // Don't trap onboarding on an access-row hiccup — the client exists;
      // surface nothing here and let the Access section on /admin show what
      // landed. (A hard failure is rare: shapes are pre-validated.)
    }
  }

  for (const admin of localAdmins) {
    // Honour each row's chosen role + scopes (mirrors Settings → Access):
    //   - viewer            → scopes null (read-only; what they SEE is gated
    //                         by enabled_services at read time).
    //   - local_super_admin → the ticked capability scopes. Over-broad scopes
    //                         (e.g. socials on an ads-only client) are harmless
    //                         — manageableCapabilities() clamps them to
    //                         enabled_services, so the grant simply activates
    //                         if that service is turned on later.
    const { error } = await supabase
      .from("client_allowed_emails")
      .insert({
        client_id: clientId,
        email: admin.email,
        note: null,
        role: admin.role,
        scopes: admin.role === "local_super_admin" ? admin.scopes : null,
      });
    if (error && error.code !== "23505") {
      // Same best-effort stance as domains above.
    }
  }

  // Invalidate the clients list so the new entry appears immediately.
  revalidatePath("/clients");

  // Land on /admin so the super-admin can finish the setup checklist. Open
  // the tab that matches a product the client actually has (Ads, else Socials,
  // else Web & SEO) so the initial tab is never an empty/disallowed one.
  const fromTab = enabledServices.includes("ads")
    ? "ads"
    : enabledServices.includes("socials")
      ? "socials"
      : "web";
  redirect(`/${slug}/admin?from=${fromTab}`);
}
