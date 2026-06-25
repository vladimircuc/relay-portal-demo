/**
 * Client Socials dashboard.
 *
 * Driven by the historical data layer (social_daily_metrics):
 *   - Date-range selector (Plannable presets), own period cookie, bounded by
 *     the client's actual stored history.
 *   - SocialsExplorer: 5 metric tiles (recompute for the selected range) +
 *     a tile-driven daily trend chart (Total / By platform) + per-platform
 *     breakdown with checkboxes.
 *   - Empty state when nothing is connected.
 */
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { format, parseISO, subDays } from "date-fns";
import { Users } from "lucide-react";
import { getCurrentUser, resolveAccess, visibleSections, type ResolvedClient } from "@/lib/auth";
import { DashboardHeader } from "@/components/dashboard-header";
import { ServiceSubheader } from "@/components/service-subheader";
import { SocialsConnectButton, OpenSocialsConnectButton } from "@/components/socials-connect-button";
import { SocialCredentialsSection } from "@/components/admin/social-credentials-section";
import { RecentClientTracker } from "@/components/recent-client-tracker";
import { SocialBackfillOverlay } from "@/components/social-backfill-overlay";
import { orderClientsByRecents } from "@/lib/recent-clients";
import { readRecentClientSlugs } from "@/lib/recent-clients-server";
import { readPeriodFromCookies, SOCIALS_PERIOD_COOKIE } from "@/lib/prefs";
import { fetchSocialDateBounds, fetchSocialsAnalytics, fetchTopContent, fetchContentLibrary, fetchSocialsContentMix } from "@/lib/socials-timeseries";
import { SocialsPeriodPicker } from "@/components/socials-period-picker";
import { SocialsExplorer, PlatformScorecard } from "@/components/socials-explorer";
import { TopContent } from "@/components/top-content";
import { ContentLibrary } from "@/components/content-library";
import { SocialsBoard } from "@/components/socials-board";
import { PostingCadence } from "@/components/posting-cadence";
import { ContentTypeBreakdown } from "@/components/content-type-breakdown";
import { LockedTab } from "@/components/locked-tab";

export const runtime = "edge";
export const maxDuration = 60;

const RESERVED_SLUGS = new Set([
  "login", "logout", "auth", "no-access", "clients", "api", "admin", "favicon.ico",
]);

export default async function SocialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ meta_picker?: string }>;
}) {
  const { clientSlug } = await params;
  const { meta_picker } = await searchParams;
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
    // Tried another client's slug → bounce to their own Home (universal).
    redirect(`/${access.client.slug}/home`);
  } else {
    notFound();
  }

  // Product tabs this client OWNS — drives the section nav (every tab renders;
  // tabs the client doesn't own show a lock + open a teaser).
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

  // Entitlement: a client WITHOUT Socials still sees the tab — but LOCKED. We
  // render the header (so they can still navigate) + a blurred teaser and an
  // upgrade modal, rather than redirecting away.
  if (!client.enabled_services.includes("socials")) {
    return (
      <>
        <RecentClientTracker slug={client.slug} />
        <DashboardHeader
          client={client}
          section="Socials"
          sectionNav={{ slug: client.slug, active: "socials", sections }}
          user={{ email: user.email }}
          adminHref={canManageThisClient ? `/${client.slug}/admin?from=socials` : undefined}
          switcher={switcher}
        />
        <main className="w-[92vw] lg:w-[75vw] max-w-[1200px] mx-auto py-6">
          <LockedTab service="socials" />
        </main>
      </>
    );
  }

  // CONNECTING / managing social accounts (connect, disconnect, on-connect
  // backfill) is open to anyone who can VIEW this socials-enabled client —
  // viewers included, not just socials-scope admins. Self-serve connection is
  // the product: a client wires up their own Facebook/IG/TikTok/etc. right from
  // this dashboard. Mirrors the `requireClientAccess` gate the connect routes +
  // server actions now use. Everyone who reaches this line has already cleared
  // the view + entitlement gates above, so it's effectively always true; kept
  // explicit so the intent (and the parallel to the server guards) is obvious.
  // NOTE: the /admin Settings Socials TAB stays scope-gated
  // (manageableCapabilities) — only this in-dashboard connect flow is opened up.
  const canConnectSocials =
    access.kind === "super_admin" ||
    access.kind === "admin" ||
    (access.kind === "client_user" && access.client.id === client.id);

  // ── Resolve the selected period (bounds from stored history, cookie pref
  //    clamped, default last 30 days).
  const cookieStore = await cookies();
  const bounds = await fetchSocialDateBounds(client.id);
  const dataEnd = bounds.maxDay ? parseISO(bounds.maxDay) : new Date();
  const minSelectable = bounds.minDay ? parseISO(bounds.minDay) : dataEnd;
  const defaultStart = subDays(dataEnd, 29);

  let start = defaultStart < minSelectable ? minSelectable : defaultStart;
  let end = dataEnd;
  const pref = readPeriodFromCookies(cookieStore, SOCIALS_PERIOD_COOKIE);
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
  const periodLabel = `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;

  const lenDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const compEnd = subDays(start, 1);
  const compStart = subDays(compEnd, lenDays - 1);
  const comparisonLabel = `vs ${format(compStart, "MMM d")} – ${format(compEnd, "MMM d, yyyy")}`;

  // "Updated …" stamp — the last time the cron pulled socials. Display only;
  // socials are cron-only, so there's no manual refresh button (unlike Ads).
  // Formatted in the CLIENT's timezone (the function runtime is UTC). Falls
  // back to the newest stored day until the first social run lands.
  const lastUpdatedLabel = bounds.lastRunAt
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: client.timezone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(bounds.lastRunAt))
    : `through ${format(dataEnd, "MMM d")}`;

  // Friendly timezone note for the cadence heatmap — the heatmap buckets posts
  // by the client's local clock, so we tell the reader whose clock it is.
  // "America/Chicago" → "Chicago time".
  const tzLabel = client.timezone
    ? `${client.timezone.split("/").pop()?.replace(/_/g, " ")} time`
    : undefined;

  const [analytics, topContent, contentLibrary, contentMix] = await Promise.all([
    fetchSocialsAnalytics({
      clientId: client.id,
      start: startStr,
      end: endStr,
      compStart: format(compStart, "yyyy-MM-dd"),
      compEnd: format(compEnd, "yyyy-MM-dd"),
    }),
    fetchTopContent({ clientId: client.id, start: startStr, end: endStr, timezone: client.timezone }),
    fetchContentLibrary({ clientId: client.id, start: startStr, end: endStr, timezone: client.timezone }),
    fetchSocialsContentMix({ clientId: client.id, start: startStr, end: endStr, timezone: client.timezone }),
  ]);

  return (
    <>
      <RecentClientTracker slug={client.slug} />
      {/* On-connect "pulling your history…" blocker. Inert unless a backfill
          is in flight (driven by the ?<platform>_connected=1 OAuth return).
          Only relevant to someone who can connect — now any viewer of the client. */}
      {canConnectSocials && <SocialBackfillOverlay clientId={client.id} />}
      <DashboardHeader
        client={client}
        section="Socials"
        // Home/Ads/Socials switcher, driven by the client's entitled products
        // (visibleSections). Shown to every viewer of a socials-enabled client.
        sectionNav={{ slug: client.slug, active: "socials", sections }}
        user={{ email: user.email }}
        adminHref={canManageThisClient ? `/${client.slug}/admin?from=socials` : undefined}
        // Branded PDF report export — universal across product tabs.
        report={{ clientId: client.id, services: client.enabled_services }}
        // Per-service action bar (status-led split row): live freshness on the
        // left, the Connect Platform control on the right.
        subheader={
          <ServiceSubheader
            updatedLabel={lastUpdatedLabel}
            actions={
              canConnectSocials ? (
                <SocialsConnectButton
                  connectedCount={analytics.connectedCount}
                  autoOpen={meta_picker === "1"}
                >
                  <Suspense fallback={<ConnectPanelSkeleton />}>
                    <SocialCredentialsSection clientId={client.id} clientSlug={client.slug} returnTo="socials" />
                  </Suspense>
                </SocialsConnectButton>
              ) : undefined
            }
          />
        }
        switcher={switcher}
      />

      <main className="w-[92vw] lg:w-[75vw] max-w-[1200px] mx-auto py-6 flex flex-col gap-6 md:gap-8">
        {analytics.connectedCount === 0 ? (
          <EmptyState canManage={canConnectSocials} />
        ) : (
          <>
            {/* Mobile-only connect button — the desktop connect control lives in
                the subheader (hidden on mobile); this surfaces the same flow on
                phones by firing OPEN_SOCIALS_CONNECT_EVENT to that still-mounted
                button (its modal is portaled to <body>, so it opens fine). */}
            {canConnectSocials && (
              <div className="md:hidden">
                <OpenSocialsConnectButton className="w-full justify-center inline-flex items-center gap-2 h-11 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] text-[13px] font-semibold hover:bg-[var(--ps-yellow-soft)] transition-colors" />
              </div>
            )}
          <SocialsBoard
            picker={
              <SocialsPeriodPicker
                startStr={startStr}
                endStr={endStr}
                minDateStr={format(minSelectable, "yyyy-MM-dd")}
                maxDateStr={format(dataEnd, "yyyy-MM-dd")}
                comparisonLabel={comparisonLabel}
              />
            }
            core={
              <>
                <SocialsExplorer analytics={analytics} periodLabel={periodLabel} dataEndStr={format(dataEnd, "yyyy-MM-dd")} />
                <TopContent items={topContent} clientId={client.id} />
              </>
            }
            details={
              <>
                <PlatformScorecard analytics={analytics} />
                {/* When + what gets published. Left = compact cadence heatmap,
                    right (bigger) = content-type donut with its legend beside it.
                    grid-cols-1 base so the mobile single column fills + shrinks to
                    the screen (a bare grid uses auto/max-content columns, which
                    left-aligned the content with empty space to the right). */}
                <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
                  <PostingCadence
                    matrix={contentMix.cadence}
                    rowLabels={contentMix.rowLabels}
                    dayLabels={contentMix.dayLabels}
                    tzLabel={tzLabel}
                  />
                  <ContentTypeBreakdown slices={contentMix.byType} />
                </section>
                <ContentLibrary items={contentLibrary} clientId={client.id} />
              </>
            }
          />
          </>
        )}
      </main>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Connect-modal panel skeleton — shown only during the initial server stream
// of the credentials query (the modal is closed at that point, so users
// effectively never see it; it just keeps the panel query off the page's
// critical render path).

function ConnectPanelSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-5">
      <div className="ps-skeleton h-6 w-40 rounded-md" />
      <div className="ps-skeleton h-3 w-3/4 rounded-md opacity-60" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="ps-skeleton h-16 w-full rounded-md" />
      ))}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state — no platforms connected

function EmptyState({ canManage }: { canManage: boolean }) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-12 flex flex-col items-center text-center">
      <Users size={36} className="text-[var(--text-tertiary)] mb-4" />
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">No social accounts connected yet</h2>
      <p className="text-[13px] text-[var(--text-secondary)] mb-5 max-w-md leading-relaxed">
        Connect Facebook, Instagram, YouTube, TikTok, or LinkedIn to start tracking organic
        performance across platforms in one place.
      </p>
      {canManage ? (
        // Opens the same connect modal as the header button (via
        // OPEN_SOCIALS_CONNECT_EVENT) so the client self-serves right here,
        // instead of being sent to the /admin Settings page.
        <OpenSocialsConnectButton />
      ) : (
        <span className="text-[12px] text-[var(--text-tertiary)] italic">
          Ask your Relay rep to wire up your social accounts.
        </span>
      )}
    </section>
  );
}
