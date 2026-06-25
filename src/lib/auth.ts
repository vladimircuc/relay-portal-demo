/**
 * Server-side auth helpers.
 *
 * Tiers:
 *
 *   super_admin   Explicit allowlist (`app_admin_emails.role='super_admin'`).
 *                 Global write across every client.
 *
 *   admin         posted-social.com domain or explicit `app_admin_emails`
 *                 row with role='admin'. Browses every client's dashboard,
 *                 no /admin write.
 *
 *   client_user   Mapped to one client via `client_domains` or
 *                 `client_allowed_emails`. The per-email row also carries
 *                 a `role` ('viewer' | 'local_super_admin'). Local
 *                 super-admins get /admin write access ON THEIR CLIENT
 *                 only — for everywhere else they're indistinguishable
 *                 from a viewer (in fact they can't even see other
 *                 clients). Domain-based access is always viewer-only
 *                 (a domain match is too broad to grant elevated
 *                 rights through).
 *
 *   no_access     Falls through everything above. Also: a client_user
 *                 whose mapped client isn't active resolves to
 *                 no_access — paused/deleted clients can't be logged
 *                 into by their own users.
 *
 * Decision order: super_admin → admin → client_user → no_access.
 *
 * All checks run server-side via the admin client (service_role), so RLS
 * doesn't gate the lookup. None of this leaks to the browser.
 */
import { createAdminClient, createServerClient } from "@/lib/supabase/server";

/** Extract the lowercased domain portion of an email. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

/** Returns the authenticated Supabase user, or null. */
export async function getCurrentUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Lifecycle state of a client. Driven by the Status section on /admin. */
export type ClientStatus = "active" | "paused" | "deleted";

/**
 * Per-client custom labels for the MIDDLE TWO funnel stages.
 *
 * Stage 1 (Lead) and Stage 4 (Conversion) are universal across every
 * client/industry — hardcoded in the dashboard so we can use proper
 * singular/plural grammar ("Lead" vs "Leads", "Conversion" vs
 * "Conversions"). Only stages 2 + 3 vary in real onboarding: "Booking"
 * → "Quote Sent" / "Consult Scheduled", "Show" → "Discovery Held" /
 * "Consult Attended", etc.
 *
 * Stored singular so we never have to auto-pluralise a custom term like
 * "Quote Sent" (which would break as "Quote Sents").
 */
export type FunnelLabels = {
  booking: string;
  show: string;
};

export type ResolvedClient = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  status: ClientStatus;
  brand_logo_url: string | null;
  brand_accent_color: string | null;
  /** Stage-to-stage funnel goals (decimals 0..1). null = no goal set. */
  goal_lead_to_booking: number | null;
  goal_show_rate: number | null;
  goal_show_to_conversion: number | null;
  /** Custom funnel stage labels — every funnel/cost/revenue/projected
   *  section uses these instead of hard-coded names. */
  funnel_labels: FunnelLabels;
  /** Flat $/show surcharge folded into revenue (e.g. STL Sports
   *  Clinic's $67 consult fee). 0 for every client without a
   *  per-visit fee — which is everyone except STL today. The admin UI
   *  uses this to hide the "Revenue Rules" section unless a value
   *  is set, so the admin pages of unaffected clients stay clean. */
  revenue_per_show: number;
  /** When true (default), the Ads dashboard counts only Meta-sourced leads
   *  (GHL `source` starts with "Meta"). False = count every source, for
   *  clients whose GHL source field isn't the standard "Meta - <ad>"
   *  convention (e.g. STL Sports Clinic). See migration 031 +
   *  lib/meta-source.ts. */
  ads_meta_source_only: boolean;
  /**
   * Services this client is entitled to — a subset of {ads, socials, web, seo}
   * chosen at onboarding (migrations 029 + 037). The single source of truth that
   * drives (a) which product tabs render in the dashboard nav, (b) the Home-tab
   * "here's what you can see" copy, and (c) which /admin capability tabs can be
   * managed (a local admin's manage-scopes are INTERSECTED with this — you can't
   * manage a product the client lacks). `web` = the Web & SEO product; `seo` is
   * an upsell that implies web and only gates the Local heatmap. Always
   * non-empty: every pre-feature client defaults to ['ads'].
   */
  enabled_services: Service[];
};

/** Columns from the `clients` table that every consumer of resolveAccess
 *  may need. Keep this in sync with ResolvedClient. */
const CLIENT_FIELDS =
  "id, slug, name, timezone, status, brand_logo_url, brand_accent_color, goal_lead_to_booking, goal_show_rate, goal_show_to_conversion, funnel_label_booking, funnel_label_show, revenue_per_show, ads_meta_source_only, enabled_services";

/**
 * Reshape a raw clients row from Supabase into ResolvedClient. The DB
 * stores the two custom label columns flat; we collapse them into a
 * `funnel_labels` object so consumers don't deal with separate fields.
 */
type RawClientRow = Omit<ResolvedClient, "funnel_labels"> & {
  funnel_label_booking: string;
  funnel_label_show: string;
};

function shapeClient(row: RawClientRow): ResolvedClient {
  const { funnel_label_booking, funnel_label_show, ...rest } = row;
  return {
    ...rest,
    // Postgres `numeric` columns can come back as either number or
    // string via supabase-js depending on driver/version. Coerce so
    // every consumer can assume a plain number.
    revenue_per_show: Number(rest.revenue_per_show) || 0,
    // `admin_capability[]` arrives as a JSON array of strings; normalise to
    // a clean, known-capability Capability[] (never null/empty — see helper).
    enabled_services: parseEnabledServices(rest.enabled_services),
    funnel_labels: {
      booking: funnel_label_booking,
      show: funnel_label_show,
    },
  };
}

/**
 * Per-client role for someone resolved as a client_user. Drives the
 * read-only-vs-write gate on /<slug>/admin. Domain matches are
 * always 'viewer' (we never elevate via a broad domain rule).
 */
export type ClientUserRole = "viewer" | "local_super_admin";

/**
 * A managed PRODUCT — the unit that gets a dashboard tab, a settings tab, and a
 * per-user permission scope. Mirrors the Ads | Socials | Web & SEO split.
 *
 *   "ads"     → credentials, pipeline, ETL, funnel labels/goals, revenue
 *   "socials" → connected social accounts / OAuth
 *   "web"     → the unified "Web & SEO" product (Search Console + GA4 + Bing AI,
 *               and — for seo-entitled clients — the Local heatmap). A client is
 *               entitled to it when `web` is in enabled_services.
 *
 * A local_super_admin grant carries an optional `scopes` array. NULL
 * (the back-compat case for every pre-027 row) means ALL capabilities;
 * an explicit array narrows them. Global super-admins always have every
 * capability and ignore this entirely.
 */
export type Capability = "ads" | "socials" | "web";
export const ALL_CAPABILITIES: readonly Capability[] = ["ads", "socials", "web"];

/**
 * A backend SERVICE a client can be entitled to (clients.enabled_services).
 * Superset of Capability by one value: `seo`.
 *
 *   web → the BASE "Web & SEO" product (1:1 with the `web` Capability).
 *   seo → an UPSELL that IMPLIES web (everyone on seo is on web). It is NOT a
 *         product of its own — no tab, no settings tab, no permission — it only
 *         gates the Local heatmap section inside the Web & SEO tab.
 *
 * So tabs / settings / scopes all operate on Capability (web), while the seo
 * upsell is read directly off enabled_services where the heatmap is gated.
 */
export type Service = "ads" | "socials" | "web" | "seo";
export const ALL_SERVICES: readonly Service[] = ["ads", "socials", "web", "seo"];

/**
 * Coerce a raw `scopes` value from client_allowed_emails into a typed
 * capability list. NULL/undefined → null (= all capabilities, the
 * legacy meaning). An array is filtered to known capabilities so a
 * future enum value we don't understand can't silently grant rights.
 */
function parseScopes(raw: unknown): Capability[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: Capability[] = [];
  for (const s of raw) {
    // Legacy forward-map: the old "seo" scope is the same managed product as
    // the new unified "web" (Web & SEO). Any pre-037 grant scoped to "seo"
    // therefore reads as "web". De-dupe so a row carrying both collapses.
    const cap = s === "seo" ? "web" : s;
    if ((cap === "ads" || cap === "socials" || cap === "web") && !out.includes(cap)) {
      out.push(cap);
    }
  }
  return out;
}

/**
 * Coerce a raw `clients.enabled_services` value into a typed capability list.
 * Unlike `parseScopes`, this NEVER returns null/empty: the column is NOT NULL
 * DEFAULT {ads} and onboarding enforces ≥1 service, so a null / non-array /
 * all-unknown value can only mean a parse failure or a pre-feature row — in
 * which case we fall back to the universal ['ads'] baseline (the implicit
 * truth before migration 029) rather than render a client with zero products.
 */
export function parseEnabledServices(raw: unknown): Service[] {
  const arr: Service[] = [];
  if (Array.isArray(raw)) {
    for (const s of raw) {
      if ((s === "ads" || s === "socials" || s === "web" || s === "seo") && !arr.includes(s)) {
        arr.push(s);
      }
    }
  }
  // Invariant: seo ⟹ web. The SEO upsell always rides on the Web base, so a row
  // that somehow has seo without web is normalised here (belt-and-braces; the
  // onboarding + settings writes enforce it too).
  if (arr.includes("seo") && !arr.includes("web")) arr.push("web");
  // Never empty: a null / non-array / all-unknown value (parse failure or
  // pre-029 row) falls back to the universal ['ads'] baseline.
  return arr.length > 0 ? arr : ["ads"];
}

export type AccessResult =
  | { kind: "super_admin"; allClients: ResolvedClient[] }
  | {
      kind: "admin";
      allClients: ResolvedClient[];
      /**
       * Client IDs on which this admin ALSO has a local_super_admin row
       * in client_allowed_emails. Admin tier is browse-only by default,
       * but these specific clients give them /admin write access on top.
       *
       * The model is additive: agency-domain user → "admin" tier (sees
       * everyone, can't edit) → plus extra per-client write rights
       * scoped to whatever rows exist for them in client_allowed_emails.
       * Lets us scope a contractor or App Review reviewer to one client
       * without losing the agency-wide browse view.
       */
      localAdminClientIds: string[];
      /**
       * Per-client capability scopes, keyed by the same client IDs in
       * `localAdminClientIds`. `null` for a client means that grant has
       * no scope restriction (all capabilities — the pre-027 default);
       * an array narrows it to those tabs. Clients NOT in
       * localAdminClientIds have no entry here.
       */
      localAdminScopes: Record<string, Capability[] | null>;
    }
  | {
      kind: "client_user";
      client: ResolvedClient;
      role: ClientUserRole;
      /**
       * Capability scopes for a local_super_admin client_user. `null` =
       * all capabilities (back-compat / unscoped grant). Always `null`
       * for plain viewers and domain matches — only meaningful when
       * role==='local_super_admin'.
       */
      scopes: Capability[] | null;
    }
  | { kind: "no_access" };

/** Convenience helper: anything that gets full multi-client access. */
export function hasMultiClientAccess(a: AccessResult): a is
  | { kind: "super_admin"; allClients: ResolvedClient[] }
  | {
      kind: "admin";
      allClients: ResolvedClient[];
      localAdminClientIds: string[];
      localAdminScopes: Record<string, Capability[] | null>;
    } {
  return a.kind === "super_admin" || a.kind === "admin";
}

/**
 * True when the given access can write to the per-client /admin page
 * for the client with `clientId`. Three paths qualify:
 *   1. Global super_admin (writes anywhere)
 *   2. Admin tier (PS domain or app_admin_emails 'admin') with a
 *      local_super_admin row on THIS client in client_allowed_emails
 *   3. Client-user with role='local_super_admin' on this specific client
 *
 * Regular admin without an explicit local_super_admin row is browse-only.
 * The two local_super_admin paths (#2 and #3) are functionally identical
 * — both come from a row in client_allowed_emails with that role. The
 * difference is whether the user ALSO matches the agency domain (#2:
 * they do, so resolveAccess returned admin tier; #3: they don't, so
 * resolveAccess returned client_user tier).
 *
 * Use this in both UI render decisions (showing the settings gear) and
 * server-action gates (`requireAdminForClient`).
 */
export function canAdminClient(a: AccessResult, clientId: string): boolean {
  if (a.kind === "super_admin") return true;
  if (a.kind === "admin" && a.localAdminClientIds.includes(clientId)) {
    return true;
  }
  if (
    a.kind === "client_user" &&
    a.role === "local_super_admin" &&
    a.client.id === clientId
  ) {
    return true;
  }
  return false;
}

/**
 * Server-action guard — throws unless the caller can admin `clientId`.
 * Wraps the getCurrentUser → resolveAccess → canAdminClient sequence
 * that every per-client mutation needs.
 */
export async function requireAdminForClient(clientId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.email) throw new Error("Not authenticated");
  const access = await resolveAccess(user.email);
  if (!canAdminClient(access, clientId)) throw new Error("Forbidden");
}

/**
 * The client's `enabled_services` as seen through a given AccessResult, or
 * null when this access has no resolved view of `clientId` (so we can't know
 * its entitlements). super_admin/admin carry every client in `allClients`;
 * a client_user only knows its own `client`.
 */
function enabledServicesFor(
  a: AccessResult,
  clientId: string,
): Service[] | null {
  if (a.kind === "super_admin" || a.kind === "admin") {
    return a.allClients.find((c) => c.id === clientId)?.enabled_services ?? null;
  }
  if (a.kind === "client_user" && a.client.id === clientId) {
    return a.client.enabled_services;
  }
  return null;
}

/**
 * Which /admin capability tabs this access can manage for `clientId`.
 *
 * Two factors combine (intersection):
 *   1. ROLE grant — what the user is allowed to manage by their tier/scopes:
 *        super_admin               → every capability (global write)
 *        admin w/ local grant here → the grant's scopes, or ALL if unscoped
 *        client_user local_super   → its scopes, or ALL if unscoped
 *        everyone else             → [] (browse-only / viewer / no_access)
 *   2. CLIENT entitlement — `client.enabled_services`. You can't manage a
 *      product the client doesn't have, so even a super-admin gets only
 *      {ads} for an Ads-only client. This is what stops a "Socials settings"
 *      tab from appearing for a client that never bought Socials.
 *
 * This is the single source of truth for tab gating: the settings page
 * passes the result as `allowedTabs`, and `canManageScope` /
 * `requireScopeForClient` below are defined in terms of it so the UI and
 * the server-action guards can never disagree — and both automatically
 * respect enabled_services for free.
 *
 * NOTE: managing the per-client ACCESS list (adding viewers/domains) is
 * deliberately NOT gated by capability — any local super-admin can do it
 * regardless of scope (see canAdminClient). Only the capability TABS
 * (Ads/Socials settings) are scoped.
 */
export function manageableCapabilities(
  a: AccessResult,
  clientId: string,
): Capability[] {
  // 1. What the user's role/scopes allow.
  let byRole: Capability[];
  if (a.kind === "super_admin") {
    byRole = [...ALL_CAPABILITIES];
  } else if (a.kind === "admin") {
    if (!a.localAdminClientIds.includes(clientId)) return [];
    const scopes = a.localAdminScopes[clientId] ?? null;
    byRole = scopes === null ? [...ALL_CAPABILITIES] : scopes;
  } else if (
    a.kind === "client_user" &&
    a.role === "local_super_admin" &&
    a.client.id === clientId
  ) {
    byRole = a.scopes === null ? [...ALL_CAPABILITIES] : a.scopes;
  } else {
    return [];
  }

  // 2. Bound by what the client actually has. `enabled` is non-null whenever
  // `byRole` is non-empty (the role checks above only pass for a client this
  // access can see), so the fallback is just defensive.
  const enabled = enabledServicesFor(a, clientId);
  if (enabled === null) return byRole;
  return byRole.filter((c) => enabled.includes(c));
}

/** True when `a` can manage `capability` on `clientId`. */
export function canManageScope(
  a: AccessResult,
  clientId: string,
  capability: Capability,
): boolean {
  return manageableCapabilities(a, clientId).includes(capability);
}

/**
 * Which PRODUCT sections (Ads / Socials) to render in the dashboard nav for
 * this access on this client, in canonical Ads-then-Socials order. Home is
 * always shown by the nav itself and is NOT included here — this returns only
 * the optional product tabs.
 *
 * VIEWING a product tab is gated purely by the client's entitlement
 * (`enabled_services`), NOT by the viewer's manage-scopes: a local admin
 * scoped to Ads still SEES the Socials dashboard on a socials-enabled client
 * (they just can't manage its settings). So every role that can view the
 * client sees the same product tabs = the client's enabled_services.
 *
 * Returns [] when `a` can't view `client` at all (defensive — callers
 * generally only reach here with an already-resolved, viewable client).
 */
export function visibleSections(
  a: AccessResult,
  client: ResolvedClient,
): Capability[] {
  const canView =
    a.kind === "super_admin" ||
    a.kind === "admin" ||
    (a.kind === "client_user" && a.client.id === client.id);
  if (!canView) return [];
  return ALL_CAPABILITIES.filter((c) => client.enabled_services.includes(c));
}

/**
 * Server-action guard — throws unless the caller can manage `capability`
 * on `clientId`. The capability-scoped counterpart to
 * requireAdminForClient: use it on every Ads-tab or Socials-tab mutation
 * so a socials-scoped local admin can't poke ads settings and vice-versa.
 *
 * Because it's defined via canManageScope → manageableCapabilities, it also
 * enforces the client's `enabled_services` for free: a mutation on a product
 * the client isn't entitled to throws even for a global super-admin.
 */
export async function requireScopeForClient(
  clientId: string,
  capability: Capability,
): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.email) throw new Error("Not authenticated");
  const access = await resolveAccess(user.email);
  if (!canManageScope(access, clientId, capability)) {
    throw new Error("Forbidden");
  }
}

/**
 * Server-action guard — throws unless the caller is a GLOBAL super_admin.
 * Used for actions that aren't scoped to a single client (creating new
 * clients, future Posted-Social-wide settings).
 */
export async function requireGlobalSuperAdmin(): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.email) throw new Error("Not authenticated");
  const access = await resolveAccess(user.email);
  if (access.kind !== "super_admin") throw new Error("Forbidden");
}

/**
 * Server-action guard — throws unless the caller can VIEW the client
 * (super_admin / admin / matching client_user). Broader than
 * requireAdminForClient: viewers and domain-matched users pass.
 *
 * Used by actions any dashboard visitor is allowed to trigger — like
 * the public "Refresh data" button, where every viewer should be able
 * to pull fresh numbers on their own dashboard.
 */
export async function requireClientAccess(clientId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.email) throw new Error("Not authenticated");
  const access = await resolveAccess(user.email);
  if (access.kind === "super_admin" || access.kind === "admin") return;
  if (access.kind === "client_user" && access.client.id === clientId) return;
  throw new Error("Forbidden");
}

export async function resolveAccess(email: string): Promise<AccessResult> {
  const lowerEmail = email.toLowerCase().trim();
  const domain = emailDomain(lowerEmail);
  if (!domain) return { kind: "no_access" };

  const supabase = createAdminClient();

  // ── Tier check: look up the admin domain + this email's role (if any) ─────
  const [{ data: cfg }, { data: adminRow }] = await Promise.all([
    supabase
      .from("app_config")
      .select("value")
      .eq("key", "admin_domain")
      .maybeSingle(),
    supabase
      .from("app_admin_emails")
      .select("email, role")
      .eq("email", lowerEmail)
      .maybeSingle(),
  ]);

  const adminDomain = cfg?.value?.toLowerCase();
  const matchesAdminDomain = adminDomain ? domain === adminDomain : false;
  const allowlistRole = adminRow?.role as "admin" | "super_admin" | undefined;

  // Super-admin requires an explicit allowlist row with role='super_admin'.
  // Returns clients across ALL statuses (active + paused + deleted) — the
  // /clients page groups them into sections, and super-admin can still
  // open a paused/deleted dashboard to inspect or restore.
  if (allowlistRole === "super_admin") {
    const allClients = await loadAllClientsForAdmin(supabase);
    return { kind: "super_admin", allClients };
  }

  // Admin: posted-social.com domain OR allowlist row with role='admin'.
  // Same all-statuses visibility as super-admin (Relay staff need
  // to see paused/deleted clients too), just without /admin write access.
  //
  // ON TOP OF browse access, we ALSO load any client_allowed_emails rows
  // for this email with role='local_super_admin' and attach those client
  // IDs as `localAdminClientIds`. Those are the clients where this
  // agency-domain user can ALSO write to /admin (Settings page). The
  // model is additive: domain match grants broad browse, explicit per-
  // email rows grant per-client write on top.
  //
  // Use case: scope a contractor or App Review reviewer to one client
  // for /admin write access while keeping the agency-wide browse view.
  if (matchesAdminDomain || allowlistRole === "admin") {
    const [allClients, { data: localAdminRows }] = await Promise.all([
      loadAllClientsForAdmin(supabase),
      supabase
        .from("client_allowed_emails")
        .select("client_id, scopes")
        .eq("email", lowerEmail)
        .eq("role", "local_super_admin"),
    ]);
    const rows = (localAdminRows ?? []) as {
      client_id: string | null;
      scopes: unknown;
    }[];
    const localAdminClientIds: string[] = [];
    const localAdminScopes: Record<string, Capability[] | null> = {};
    for (const r of rows) {
      if (typeof r.client_id !== "string") continue;
      localAdminClientIds.push(r.client_id);
      localAdminScopes[r.client_id] = parseScopes(r.scopes);
    }
    return { kind: "admin", allClients, localAdminClientIds, localAdminScopes };
  }

  // ── Client-user check: try domain match first, then email allowlist ───────
  // Client users only get to see ACTIVE clients. If their assigned client
  // is paused or deleted, we treat it as no_access so a paused account
  // can't log in until the agency flips it back. Filtering server-side
  // here is the chokepoint — the rest of the app trusts ResolvedClient.
  //
  // Role assignment:
  //   - Domain match → always 'viewer'. Domains are broad and shouldn't
  //     hand out elevated rights.
  //   - Email match → use the row's own `role` column ('viewer' or
  //     'local_super_admin'). This is where elevation happens.
  // A domain CAN map to >1 client (the unique key is (email_domain, client_id)).
  // .maybeSingle() used to ERROR on multiple matches → null → silent lockout of
  // every user on a legitimately shared domain. Fetch all matches and take the
  // first ACTIVE client instead. RLS still UNIONs all matches, so this never
  // over-grants — a client_user simply resolves to one client they're mapped to.
  const { data: domainRows } = await supabase
    .from("client_domains")
    .select(`clients!inner(${CLIENT_FIELDS})`)
    .eq("email_domain", domain);
  const domainClient = (domainRows ?? [])
    .map((r) => pickClient((r as { clients: unknown }).clients))
    .find((c): c is ResolvedClient => c !== null && c.status === "active");
  if (domainClient) {
    return { kind: "client_user", client: domainClient, role: "viewer", scopes: null };
  }

  const { data: emailRow } = await supabase
    .from("client_allowed_emails")
    .select(`role, scopes, clients!inner(${CLIENT_FIELDS})`)
    .eq("email", lowerEmail)
    .maybeSingle();
  const emailClient = pickClient(emailRow?.clients);
  if (emailClient && emailClient.status === "active") {
    const role: ClientUserRole =
      emailRow?.role === "local_super_admin" ? "local_super_admin" : "viewer";
    // Scopes only matter for local super-admins; viewers are always null.
    const scopes = role === "local_super_admin" ? parseScopes(emailRow?.scopes) : null;
    return { kind: "client_user", client: emailClient, role, scopes };
  }

  return { kind: "no_access" };
}

/** Normalise the Supabase join shape (sometimes array, sometimes object). */
function pickClient(rel: unknown): ResolvedClient | null {
  if (!rel) return null;
  const row = Array.isArray(rel) ? (rel[0] as RawClientRow | undefined) : (rel as RawClientRow);
  if (!row) return null;
  return shapeClient(row);
}

/**
 * Loads every client visible to an admin / super-admin — that's all
 * statuses, ordered alphabetically. The /clients page groups them by
 * status; the dashboard route uses this list as the "find my slug"
 * lookup. Filtering by status is the consumer's job.
 */
async function loadAllClientsForAdmin(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<ResolvedClient[]> {
  const { data } = await supabase
    .from("clients")
    .select(CLIENT_FIELDS)
    .order("name", { ascending: true });
  return ((data as RawClientRow[]) ?? []).map(shapeClient);
}
