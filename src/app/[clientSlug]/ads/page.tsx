/**
 * Client Ads dashboard — streaming version.
 *
 * Lives under `/[clientSlug]/ads` so future modules (SEO, email, social)
 * can be added as sibling routes (`/[clientSlug]/seo`, etc.) without
 * disturbing this one. Bare `/[clientSlug]` redirects here.
 *
 * The page does only the FAST setup work (auth, client lookup, date bounds)
 * and then renders the layout with per-section Suspense boundaries. Each
 * section is its own async server component that fetches its own data via
 * React `cache()` — multiple sections requesting the same data share one DB
 * roundtrip, but each one streams in independently as soon as it's ready.
 *
 * The browser sees the page header + period bar instantly, then each card
 * fills in as its data arrives instead of staring at a single blank screen.
 */
import { Suspense } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, resolveAccess, visibleSections } from "@/lib/auth";
import { readPeriodFromCookies, readTierFromCookies, readViewModeFromCookies } from "@/lib/prefs";
import { ViewModeProvider } from "@/components/view-mode-context";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { RefreshButton } from "@/components/refresh-button";
import { ServiceSubheader } from "@/components/service-subheader";
import { fetchDateBounds } from "@/lib/dashboard-data";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardShell } from "@/components/dashboard-shell";
import { LockedTab } from "@/components/locked-tab";
import { TierConditional } from "@/components/tier-conditional";
import {
  HeroStatsSkeleton,
  SourceBreakdownSkeleton,
  FunnelSkeleton,
  EfficiencyStripSkeleton,
  PerformanceRowSkeleton,
  ProjectedCardSkeleton,
} from "@/components/skeletons";
import type { ResolvedClient } from "@/lib/auth";
import { HeroSection } from "@/components/sections/hero-section";
import { SourceSection } from "@/components/sections/source-section";
import { FunnelSection } from "@/components/sections/funnel-section";
import { EfficiencySection } from "@/components/sections/efficiency-section";
import { PerformanceSection } from "@/components/sections/performance-section";
import { ProjectedSection } from "@/components/sections/projected-section";
import { OnboardingBanner } from "@/components/onboarding-banner";
import { StatusBanner } from "@/components/status-banner";
import { ProjectionBannerSection } from "@/components/sections/projection-banner-section";
import { format, parseISO, subDays, isAfter } from "date-fns";
import { RecentClientTracker } from "@/components/recent-client-tracker";
import { orderClientsByRecents } from "@/lib/recent-clients";
import { readRecentClientSlugs } from "@/lib/recent-clients-server";

// Run the dashboard on Vercel's Edge runtime — closer to the user, lighter
// cold starts, and the only deps used here (supabase-js, date-fns,
// next/headers) are all edge-compatible.
export const runtime = "edge";

// Bump the timeout to Vercel Pro's edge max (60s). Server actions called
// from this page (notably refreshClientNow → Meta + GHL pull) inherit
// this maxDuration. GHL alone can take ~40s for a 1700+ opp client; the
// default 25s edge timeout was killing the refresh action mid-pull and
// surfacing as a generic "An unexpected response was received from the
// server" toast in the UI. 60s is the ceiling without moving to
// fluid/long-running compute on a Pro plan.
export const maxDuration = 60;

const RESERVED_SLUGS = new Set([
  "login", "logout", "auth", "no-access", "clients", "api", "admin", "favicon.ico",
]);

export default async function AdsDashboardPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  if (RESERVED_SLUGS.has(clientSlug)) notFound();

  const cookieStore = await cookies();
  const tier = readTierFromCookies(cookieStore) ?? "simple";
  const viewMode = readViewModeFromCookies(cookieStore) ?? "real";
  const periodPref = readPeriodFromCookies(cookieStore);

  // Auth + which-client-can-they-see check
  const user = await getCurrentUser();
  if (!user || !user.email) redirect("/login");
  const access = await resolveAccess(user.email);
  if (access.kind === "no_access") redirect("/no-access");

  let client: ResolvedClient;
  let allClients: ResolvedClient[] = [];
  // hasAdminView = "can browse all clients" (admin OR super_admin qualifies)
  //                — drives whether to render the client switcher.
  // canManageThisClient = "can write to /admin on THIS client"
  //                — drives whether to render the settings gear. Two
  //                paths qualify: global super_admin, or a client_user
  //                with role='local_super_admin' on their own client.
  let hasAdminView = false;
  let canManageThisClient = false;

  if (access.kind === "super_admin" || access.kind === "admin") {
    hasAdminView = true;
    allClients = access.allClients;
    if (allClients.length === 0) {
      return <ErrorScreen message="No clients have been set up yet." />;
    }
    const found = allClients.find((c) => c.slug === clientSlug);
    if (!found) redirect("/clients");
    client = found;
    // Settings gear shows when:
    //   - global super_admin (writes anywhere), OR
    //   - admin tier with an explicit local_super_admin row on THIS client
    canManageThisClient =
      access.kind === "super_admin" ||
      (access.kind === "admin" && access.localAdminClientIds.includes(found.id));
  } else {
    // client_user — viewer or local_super_admin. resolveAccess already
    // gated client.status='active', so we just verify the slug match.
    // A mismatch means they tried another client's slug → bounce to their
    // own Home (the universal landing; their client may not have Ads).
    if (access.client.slug !== clientSlug) redirect(`/${access.client.slug}/home`);
    client = access.client;
    canManageThisClient = access.role === "local_super_admin";
  }

  // Product tabs this client OWNS — drives the section nav (all tabs render;
  // unowned ones show a lock + open a teaser). Same list for every role.
  const sections = visibleSections(access, client);

  // Header client switcher (admins only). Computed once — shared by the live
  // and the locked render below.
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

  // Entitlement: a client WITHOUT Ads still sees the tab — but LOCKED. Render
  // the header (so they can navigate) + a blurred teaser and an upgrade modal,
  // instead of redirecting away.
  if (!client.enabled_services.includes("ads")) {
    return (
      <>
        <RecentClientTracker slug={client.slug} />
        <DashboardHeader
          client={client}
          section="Ads"
          sectionNav={{ slug: client.slug, active: "ads", sections }}
          user={{ email: user.email }}
          adminHref={canManageThisClient ? `/${client.slug}/admin?from=ads` : undefined}
          switcher={switcher}
        />
        <main className="w-[92vw] lg:w-[78vw] max-w-[1280px] mx-auto py-6">
          <LockedTab service="ads" />
        </main>
      </>
    );
  }

  // Date bounds — three small "what's the period range for this client?"
  // lookups. Wrapped in unstable_cache (5-min revalidate) inside
  // fetchDateBounds, so on the hot path this is a zero-DB step.
  const bounds = await fetchDateBounds(client.id);

  const dataEnd = bounds.maxDay ? parseISO(bounds.maxDay) : new Date();

  // Picker ceiling. The latest *selectable* day is "yesterday in the
  // client's timezone", NOT dataEnd. dataEnd is the last day that actually
  // has a spend-or-lead row in daily_metrics_v, so a quiet tail (ads
  // paused + no inbound leads) caps the picker at the last active day —
  // which made two equally-healthy clients show different ceilings and
  // made recent zero-activity days unselectable. Flooring at yesterday
  // makes every client uniform; we still extend to dataEnd on the rare
  // day a same-day lead lands a row that's newer than yesterday.
  const todayInClientTz = new Intl.DateTimeFormat("en-CA", { timeZone: client.timezone }).format(new Date());
  const yesterdayInClientTz = subDays(parseISO(todayInClientTz), 1);
  const selectableEnd = isAfter(dataEnd, yesterdayInClientTz) ? dataEnd : yesterdayInClientTz;

  // First-opp date must be computed in the CLIENT'S timezone, not UTC.
  // bounds.firstOppAt is a raw UTC timestamp from the earliest
  // ghl_opportunities row. Formatting it with date-fns on the server
  // (UTC) gives the UTC calendar date — which can be one day AHEAD of
  // the client's calendar date for opps created in the late evening
  // local time. That made the "Data starts" minimum (and the picker's
  // earliest-selectable day) drift forward by one day for some clients.
  const firstOppDateStr = bounds.firstOppAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: client.timezone })
        .format(new Date(bounds.firstOppAt))
    : format(dataEnd, "yyyy-MM-dd");
  const minSelectable = parseISO(firstOppDateStr);
  const defaultStart = subDays(dataEnd, 29);

  // Pick the period from cookie pref if it's valid; otherwise last 30 days.
  let start = defaultStart;
  let end = dataEnd;
  if (periodPref) {
    const cookieStart = parseISO(periodPref.start);
    const cookieEnd = parseISO(periodPref.end);
    if (!isNaN(cookieStart.getTime()) && !isNaN(cookieEnd.getTime())) {
      start = cookieStart < minSelectable ? minSelectable : cookieStart;
      end = cookieEnd > selectableEnd ? selectableEnd : cookieEnd;
    }
  }
  const startStr = format(start, "yyyy-MM-dd");
  const endStr = format(end, "yyyy-MM-dd");

  const lenDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
  );
  const compEnd = subDays(start, 1);
  const compStart = subDays(compEnd, lenDays - 1);
  const compStartStr = format(compStart, "yyyy-MM-dd");
  const compEndStr = format(compEnd, "yyyy-MM-dd");

  // Format the "Updated …" stamp in the CLIENT'S timezone, not the
  // function runtime's (which is UTC on Vercel edge). date-fns `format`
  // doesn't take a timeZone, so use Intl.DateTimeFormat instead.
  const lastUpdatedLabel = bounds.lastRunAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: client.timezone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(bounds.lastRunAt))
    : `through ${format(dataEnd, "MMM d")}`;

  // Common props passed to most sections.
  const metricsProps = {
    clientId: client.id,
    startStr,
    endStr,
    compStartStr,
    compEndStr,
  };

  return (
    // ViewModeProvider lifted above the header so both the
    // period-bar toggle (inside DashboardShell) and the header toggle
    // share one source of truth — they're A/B placements bound to the
    // same Real-vs-Projected state.
    <ViewModeProvider initialMode={viewMode}>
      {/* Bumps this client to the top of the per-browser recents cookie
          on every load. Reads back in the switcher prop above to slim
          the dropdown to the 5 most-recently-visited clients. */}
      <RecentClientTracker slug={client.slug} />
      <DashboardHeader
        client={client}
        section="Ads"
        // Home/Ads/Socials switcher, driven by the client's entitled products
        // (visibleSections). Every viewer sees it — Home is universal and the
        // product tabs reflect enabled_services.
        sectionNav={{ slug: client.slug, active: "ads", sections }}
        user={{ email: user.email }}
        // Branded PDF report export — universal across product tabs.
        report={{ clientId: client.id, services: client.enabled_services }}
        // Per-service action bar (status-led split row): live freshness +
        // source on the left, the Real·Projected toggle + Refresh on the
        // right. Moved out of the main header now that Create Report lives
        // there. Both this toggle and the period-bar one share ViewModeContext.
        subheader={
          <ServiceSubheader
            updatedLabel={lastUpdatedLabel}
            source="Meta + Asera"
            viewToggle={<ViewModeToggle />}
            actions={<RefreshButton clientId={client.id} clientSlug={client.slug} />}
          />
        }
        // Anyone with the admin view (admin + super_admin) gets the
        // client switcher — they can browse every client's dashboard.
        // Limited to top 5 by recency so the dropdown stays scannable
        // at scale; the "All clients" link inside the switcher reveals
        // the full list. The current client is always included since
        // visiting it is what populates the cookie.
        switcher={switcher}
        // Super-admins additionally see a settings gear that opens this
        // client's /admin page (access / credentials / ETL controls).
        adminHref={canManageThisClient ? `/${client.slug}/admin?from=ads` : undefined}
      />

      <DashboardShell
        initialTier={tier}
        // Pass calendar-date STRINGS, not UTC ISO timestamps. ISOs round-tripped
        // through new Date() in the browser get interpreted in the user's local
        // TZ, which shifts the displayed day by the TZ offset (Feb 19 UTC midnight
        // shows as "Feb 18, 7 PM" in Central). Strings let the client component
        // construct local-midnight Dates directly.
        startStr={startStr}
        endStr={endStr}
        minDateStr={format(minSelectable, "yyyy-MM-dd")}
        maxDateStr={format(selectableEnd, "yyyy-MM-dd")}
        compStartStr={compStartStr}
        compEndStr={compEndStr}
      >
        {/* Top-of-page banners. Status (paused / deleted) takes
            precedence over onboarding — a paused client's incomplete
            setup isn't actionable until it's resumed, so showing both
            would be noisy. Active clients only see the onboarding
            banner, and only when setup is incomplete. */}
        {client.status !== "active" ? (
          <StatusBanner
            status={client.status}
            clientSlug={client.slug}
            canManageThisClient={canManageThisClient}
          />
        ) : (
          <Suspense fallback={null}>
            <OnboardingBanner
              clientId={client.id}
              clientSlug={client.slug}
              canManageThisClient={canManageThisClient}
            />
          </Suspense>
        )}

        {/* Projection-mode banner — only renders when the user has
            toggled to Projected. Surfaces the rates + outstanding
            count that drive the projection so the math is visible. */}
        <Suspense fallback={null}>
          <ProjectionBannerSection
            clientId={client.id}
            startStr={startStr}
            endStr={endStr}
            labels={client.funnel_labels}
          />
        </Suspense>

        {/* Hero row — streams in independently */}
        <Suspense fallback={<HeroStatsSkeleton />}>
          <HeroSection {...metricsProps} />
        </Suspense>

        {/* Source breakdown (left) + Funnel (right) — each streams independently */}
        <section className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
          <Suspense fallback={<SourceBreakdownSkeleton />}>
            <SourceSection
              clientId={client.id}
              clientSlug={client.slug}
              timezone={client.timezone}
              startStr={startStr}
              endStr={endStr}
              revenuePerShow={client.revenue_per_show}
              metaOnly={client.ads_meta_source_only}
            />
          </Suspense>
          <Suspense fallback={<FunnelSkeleton />}>
            <FunnelSection
              clientId={client.id}
              startStr={startStr}
              endStr={endStr}
              compStartStr={compStartStr}
              compEndStr={compEndStr}
              goals={{
                lead_to_booking:    client.goal_lead_to_booking,
                show_rate:          client.goal_show_rate,
                show_to_conversion: client.goal_show_to_conversion,
              }}
              labels={client.funnel_labels}
            />
          </Suspense>
        </section>

        {/* Cost efficiency + unit economics — streams in independently. The
            section component decides what to render based on tier on the
            client; the skeleton mirrors that decision using the
            server-known tier so the layout doesn't shift when data lands. */}
        <Suspense fallback={<EfficiencyStripSkeleton cells={4} withRevenueStrip={tier === "advanced"} />}>
          <EfficiencySection {...metricsProps} labels={client.funnel_labels} />
        </Suspense>

        {/* Advanced-only sections — always server-rendered, but client-side
            hidden when tier is simple so toggling Advanced stays instant. */}
        <TierConditional only="advanced">
          <Suspense fallback={<PerformanceRowSkeleton />}>
            <PerformanceSection {...metricsProps} />
          </Suspense>
          <Suspense fallback={<ProjectedCardSkeleton />}>
            <ProjectedSection
              clientId={client.id}
              startStr={startStr}
              endStr={endStr}
              labels={client.funnel_labels}
            />
          </Suspense>
        </TierConditional>
      </DashboardShell>
    </ViewModeProvider>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">Dashboard error</h1>
        <p className="text-sm text-[var(--text-secondary)]">{message}</p>
      </div>
    </main>
  );
}
