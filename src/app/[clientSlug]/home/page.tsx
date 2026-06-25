/**
 * Client Home — the universal landing tab.
 *
 * Every client has Home; Ads and Socials are per-client entitlements
 * (enabled_services, migration 029), so neither product tab is guaranteed to
 * exist. Home is therefore the safe redirect target for the bare slug, the
 * root smart-router, and the auth callback — it always resolves, and it
 * surfaces whichever product tabs the client IS entitled to.
 *
 * It's an orientation page (what this is, what you can see, how it works), so
 * it does no data fetching and renders instantly. The role-aware copy + the
 * per-product cards come from <HomeOverview>; this file just does auth, the
 * client lookup, and the header chrome (switcher / settings gear).
 */
import { notFound, redirect } from "next/navigation";
import {
  getCurrentUser,
  resolveAccess,
  visibleSections,
  type ResolvedClient,
} from "@/lib/auth";
import { DashboardHeader } from "@/components/dashboard-header";
import { HomeOverview } from "@/components/home-overview";
import { RecentClientTracker } from "@/components/recent-client-tracker";
import { orderClientsByRecents } from "@/lib/recent-clients";
import { readRecentClientSlugs } from "@/lib/recent-clients-server";

export const runtime = "edge";

const RESERVED_SLUGS = new Set([
  "login", "logout", "auth", "no-access", "clients", "api", "admin", "favicon.ico",
]);

export default async function HomePage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  if (RESERVED_SLUGS.has(clientSlug)) notFound();

  const user = await getCurrentUser();
  if (!user || !user.email) redirect("/login");
  const access = await resolveAccess(user.email);
  if (access.kind === "no_access") redirect("/no-access");

  let client: ResolvedClient;
  let allClients: ResolvedClient[] = [];
  // hasAdminView = "can browse all clients" (admin OR super_admin) → switcher.
  // canManageThisClient = "can write to /admin on THIS client" → settings gear
  // + the Manage card on Home.
  let hasAdminView = false;
  let canManageThisClient = false;

  if (access.kind === "super_admin" || access.kind === "admin") {
    hasAdminView = true;
    allClients = access.allClients;
    const found = allClients.find((c) => c.slug === clientSlug);
    if (!found) redirect("/clients");
    client = found;
    canManageThisClient =
      access.kind === "super_admin" ||
      (access.kind === "admin" && access.localAdminClientIds.includes(found.id));
  } else {
    // client_user — bounce to their own Home if they hit a different slug.
    if (access.client.slug !== clientSlug) redirect(`/${access.client.slug}/home`);
    client = access.client;
    canManageThisClient = access.role === "local_super_admin";
  }

  // Product tabs this client is entitled to — drives the header switcher and
  // the per-product cards below. Home itself is always shown by the nav.
  const sections = visibleSections(access, client);
  const isAgencyViewer = access.kind === "super_admin" || access.kind === "admin";

  return (
    <>
      {/* Bumps this client to the top of the per-browser recents cookie. */}
      <RecentClientTracker slug={client.slug} />
      <DashboardHeader
        client={client}
        section="Home"
        sectionNav={{ slug: client.slug, active: "home", sections }}
        user={{ email: user.email }}
        report={{ clientId: client.id, services: client.enabled_services }}
        // Anyone with the admin view gets the client switcher (top 5 by recency).
        switcher={
          hasAdminView
            ? {
                activeSlug: client.slug,
                clients: orderClientsByRecents(
                  allClients,
                  await readRecentClientSlugs(),
                ).map((c) => ({
                  slug: c.slug,
                  name: c.name,
                  brand_logo_url: c.brand_logo_url,
                  brand_accent_color: c.brand_accent_color,
                })),
              }
            : undefined
        }
        // Settings gear for users who can write to this client's /admin.
        adminHref={canManageThisClient ? `/${client.slug}/admin?from=home` : undefined}
      />

      <HomeOverview
        clientName={client.name}
        slug={client.slug}
        sections={sections}
        canManageThisClient={canManageThisClient}
        isAgencyViewer={isAgencyViewer}
      />
    </>
  );
}
