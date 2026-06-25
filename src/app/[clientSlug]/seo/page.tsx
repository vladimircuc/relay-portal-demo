/**
 * Client Web & SEO dashboard — entitlement-gated product tab (migrations 029 +
 * 034 + 037). The route stays /seo, but the product is "Web & SEO".
 *
 * Mirrors /socials: resolve access → guard on enabled_services.includes("web")
 * (the base product; seo ⟹ web) → render the header (Home/Ads/Socials/Web & SEO
 * switcher) + the dashboard, which reads everything from Postgres via
 * loadSeoData (GSC + GA4 + Bing search data + Bing AI citations). The `seo`
 * upsell only adds the Local heatmap section (showLocalSeo). Never hits a vendor
 * API on render.
 *
 * Date-range selection mirrors /socials: a cookie-backed DateRangePicker
 * (SEO_PERIOD_COOKIE) drives the search tiles + trend and the GA4 tiles. The
 * top-N tables + AI citations are stored snapshots (not per-day), so they
 * reflect the latest pull. The 12-month chart is a fixed trailing-year view.
 */
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, resolveAccess, visibleSections, type ResolvedClient } from "@/lib/auth";
import { DashboardHeader } from "@/components/dashboard-header";
import { RecentClientTracker } from "@/components/recent-client-tracker";
import { orderClientsByRecents } from "@/lib/recent-clients";
import { readRecentClientSlugs } from "@/lib/recent-clients-server";
import { SeoDashboard } from "@/components/seo/seo-dashboard";
import { LockedTab } from "@/components/locked-tab";
import { SeoPeriodPicker } from "@/components/seo-period-picker";
import { loadSeoData, fetchSeoDateBounds } from "@/lib/seo-data";
import { loadWebsiteLeads } from "@/lib/seo-leads";
import { readPeriodFromCookies, SEO_PERIOD_COOKIE } from "@/lib/prefs";
import { cookies } from "next/headers";
import { format, parseISO, subDays } from "date-fns";

export const maxDuration = 60;

const RESERVED_SLUGS = new Set([
  "login", "logout", "auth", "no-access", "clients", "api", "admin", "favicon.ico",
]);

export default async function SeoPage({ params }: { params: Promise<{ clientSlug: string }> }) {
  const { clientSlug } = await params;
  if (RESERVED_SLUGS.has(clientSlug)) notFound();

  const user = await getCurrentUser();
  if (!user || !user.email) redirect("/login");

  const access = await resolveAccess(user.email);
  if (access.kind === "no_access") redirect("/no-access");

  let client: ResolvedClient;
  let allClients: ResolvedClient[] = [];
  let hasAdminView = false;
  let canManageThisClient = false;

  if (access.kind === "super_admin" || access.kind === "admin") {
    hasAdminView = true;
    allClients = access.allClients;
    const found = allClients.find((c) => c.slug === clientSlug);
    if (!found) notFound();
    client = found;
    canManageThisClient =
      access.kind === "super_admin" ||
      (access.kind === "admin" && access.localAdminClientIds.includes(found.id));
  } else if (access.kind === "client_user" && access.client.slug === clientSlug) {
    client = access.client;
    canManageThisClient = access.role === "local_super_admin";
  } else if (access.kind === "client_user") {
    redirect(`/${access.client.slug}/home`);
  } else {
    notFound();
  }

  // Product tabs this client OWNS — drives the section nav (all tabs render;
  // unowned ones show a lock + open a teaser).
  const sections = visibleSections(access, client);

  // Header client switcher (admins only). Computed once — shared by the live
  // and the locked render.
  const switcher = hasAdminView
    ? {
        activeSlug: client.slug,
        clients: orderClientsByRecents(allClients, await readRecentClientSlugs()).map((c) => ({
          slug: c.slug,
          name: c.name,
          brand_logo_url: c.brand_logo_url,
          brand_accent_color: c.brand_accent_color,
        })),
      }
    : undefined;

  // Entitlement: the Web & SEO tab is gated on the `web` product. A client
  // WITHOUT web still sees the tab — LOCKED (one lock for the whole tab; the
  // inner SEO-heatmap teaser is only for web clients without the `seo` add-on,
  // so there's never two locks). Render the header + teaser instead of redirecting.
  if (!client.enabled_services.includes("web")) {
    return (
      <>
        <RecentClientTracker slug={client.slug} />
        <DashboardHeader
          client={client}
          section="Web & SEO"
          sectionNav={{ slug: client.slug, active: "web", sections }}
          user={{ email: user.email }}
          adminHref={canManageThisClient ? `/${client.slug}/admin?from=web` : undefined}
          switcher={switcher}
        />
        <main className="w-[92vw] lg:w-[78vw] max-w-[1280px] mx-auto py-6">
          <LockedTab service="web" />
        </main>
      </>
    );
  }

  // The `seo` add-on only adds the Local heatmap section inside this tab.
  // Web-only clients see the full dashboard minus that one section.
  const showLocalSeo = client.enabled_services.includes("seo");

  // ── Resolve the selected period: bounds from stored history, cookie pref
  //    clamped into them, default trailing 28 days (the window the top-N tables
  //    snapshot, so tiles + tables line up by default).
  const cookieStore = await cookies();
  const bounds = await fetchSeoDateBounds(client.id);
  const dataEnd = bounds.maxDay ? parseISO(bounds.maxDay) : new Date();
  const minSelectable = bounds.minDay ? parseISO(bounds.minDay) : dataEnd;
  const defaultStart = subDays(dataEnd, 27);
  let start = defaultStart < minSelectable ? minSelectable : defaultStart;
  let end = dataEnd;
  const pref = readPeriodFromCookies(cookieStore, SEO_PERIOD_COOKIE);
  if (pref) {
    const cs = parseISO(pref.start);
    const ce = parseISO(pref.end);
    if (!isNaN(cs.getTime()) && !isNaN(ce.getTime())) {
      start = cs < minSelectable ? minSelectable : cs;
      end = ce > dataEnd ? dataEnd : ce;
    }
  }
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");
  const lenDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const compEnd = subDays(start, 1);
  const compStart = subDays(compEnd, lenDays - 1);
  // Only show a comparison when the FULL prior window sits inside the stored data
  // range. If it reaches before the first day of data (e.g. "All time"), there's
  // nothing to compare against — so no "vs …" label, and loadSeoData returns null
  // deltas (no % badges) for the same reason.
  const hasFullComparison = compStart.getTime() >= minSelectable.getTime();
  const comparisonLabel = hasFullComparison
    ? `vs ${format(compStart, "MMM d")} – ${format(compEnd, "MMM d, yyyy")}`
    : undefined;

  const data = await loadSeoData(client.id, {
    start: startStr,
    end: endStr,
    compStart: format(compStart, "yyyy-MM-dd"),
    compEnd: format(compEnd, "yyyy-MM-dd"),
  });

  // Website leads (opt-in): website-sourced lead counts merged onto the
  // top-section series so the existing chart can plot them. Leads-only (no
  // revenue). Returns null when the toggle is off → tab renders normally.
  const leads = await loadWebsiteLeads(
    { id: client.id, timezone: client.timezone },
    {
      start: startStr,
      end: endStr,
      compStart: format(compStart, "yyyy-MM-dd"),
      compEnd: format(compEnd, "yyyy-MM-dd"),
      hasFullComparison,
    },
  );
  if (leads) {
    data.leads = { totals: leads.totals, deltas: leads.deltas };
    for (const pt of data.google.series) {
      pt.leads = leads.byDay.get(pt.day) ?? 0;
    }
  }

  return (
    <>
      <RecentClientTracker slug={client.slug} />
      <DashboardHeader
        client={client}
        section="Web & SEO"
        sectionNav={{ slug: client.slug, active: "web", sections }}
        user={{ email: user.email }}
        report={{ clientId: client.id, services: client.enabled_services }}
        adminHref={canManageThisClient ? `/${client.slug}/admin?from=web` : undefined}
        switcher={switcher}
      />
      <SeoDashboard
        data={data}
        clientId={client.id}
        showLocalSeo={showLocalSeo}
        dataEndStr={format(dataEnd, "yyyy-MM-dd")}
        picker={
          <SeoPeriodPicker
            startStr={startStr}
            endStr={endStr}
            minDateStr={format(minSelectable, "yyyy-MM-dd")}
            maxDateStr={format(dataEnd, "yyyy-MM-dd")}
            comparisonLabel={comparisonLabel}
          />
        }
      />
    </>
  );
}
