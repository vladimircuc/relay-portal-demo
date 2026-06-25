/**
 * Per-client admin page — credentials, access management, ETL controls.
 *
 * Hard-gated to super-admins only. Anyone else who lands here is bounced
 * to the dashboard. This is the ONLY place in the app where Meta + GHL
 * tokens can be set and where ETL pulls can be manually triggered.
 *
 * Layout mirrors the dashboard so navigation feels seamless:
 *   - Same <DashboardHeader> with the client switcher + Settings gear
 *     (which now points back at this same page).
 *   - Content below is three vertically stacked cards: Access, Credentials,
 *     ETL Status.
 *
 * This is the SHELL only. The three section bodies are filled in by
 * subsequent steps:
 *   - Step 3: Access (domains + allowed emails)
 *   - Step 4: Credentials (Vault-backed Meta + GHL tokens)
 *   - Step 7: ETL Status (last run + Run now + Backfill)
 */
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, resolveAccess, manageableCapabilities, type ResolvedClient } from "@/lib/auth";
import { DashboardHeader } from "@/components/dashboard-header";
import { ProgressLink } from "@/components/progress-link";
import { AccessSection } from "@/components/admin/access-section";
import { EnabledServicesSection } from "@/components/admin/enabled-services-section";
import { CredentialsSection } from "@/components/admin/credentials-section";
import { PipelineSection } from "@/components/admin/pipeline-section";
import { EtlSection } from "@/components/admin/etl-section";
import { FunnelGoalsSection } from "@/components/admin/funnel-goals-section";
import { FunnelLabelsSection } from "@/components/admin/funnel-labels-section";
import { RevenueRulesSection } from "@/components/admin/revenue-rules-section";
import { SocialCredentialsSection } from "@/components/admin/social-credentials-section";
import { SetupChecklist } from "@/components/admin/setup-checklist";
import { ClientStatusSection } from "@/components/admin/client-status-section";
import { AdminSettingsTabs } from "@/components/admin/settings-tabs";
import { SeoSettingsLoader } from "@/components/admin/seo-settings-loader";
import { RecentClientTracker } from "@/components/recent-client-tracker";
import { SocialBackfillOverlay } from "@/components/social-backfill-overlay";
import { DemoActionInterceptor } from "@/components/admin/demo-action-interceptor";
import { orderClientsByRecents } from "@/lib/recent-clients";
import { readRecentClientSlugs } from "@/lib/recent-clients-server";

// Node (not edge): the SEO settings loader lists GA4 properties via
// google-auth-library, which needs Node APIs (process/crypto) the edge runtime
// doesn't provide. Node also better fits admin's per-source backfill actions
// (40s+ for clients with 1000+ opps) — Vercel Pro's nodejs runtime allows up to
// 300s, vs edge's 60s ceiling.
export const runtime = "nodejs";
export const maxDuration = 60;

const RESERVED_SLUGS = new Set([
  "login", "logout", "auth", "no-access", "clients", "api", "admin", "favicon.ico",
]);

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientSlug: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { clientSlug } = await params;
  const { from } = await searchParams;
  if (RESERVED_SLUGS.has(clientSlug)) notFound();

  const user = await getCurrentUser();
  if (!user || !user.email) redirect("/login");

  const access = await resolveAccess(user.email);

  // Three paths can reach /admin write access:
  //
  //   1. Global super_admin — can manage any client. Picks the active
  //      one out of access.allClients.
  //   2. Admin tier (PS domain) WITH a local_super_admin row on THIS
  //      client. They keep the full client-switcher across all clients
  //      but only see the Settings gear / can enter /admin on clients
  //      where they've been granted explicit local_super_admin.
  //   3. Client-user with role='local_super_admin' whose assigned client
  //      matches the slug in the URL. Their access.client IS the client.
  //
  // Anyone else bounces back to the appropriate read-only surface.
  let client: ResolvedClient;
  let isGlobalSuperAdmin = false;
  let allClientsForSwitcher: ResolvedClient[] = [];

  if (access.kind === "super_admin") {
    isGlobalSuperAdmin = true;
    allClientsForSwitcher = access.allClients;
    const found = allClientsForSwitcher.find((c) => c.slug === clientSlug);
    if (!found) redirect("/clients");
    client = found;
  } else if (access.kind === "admin") {
    // Admin tier: allowed into /admin ONLY for clients where they hold a
    // local_super_admin row. Otherwise bounce them to the Home view
    // (browse-only) of the slug they tried to reach.
    const found = access.allClients.find((c) => c.slug === clientSlug);
    if (!found) redirect("/clients");
    if (!access.localAdminClientIds.includes(found.id)) {
      redirect(`/${clientSlug}/home`);
    }
    allClientsForSwitcher = access.allClients;
    client = found;
  } else if (
    access.kind === "client_user" &&
    access.role === "local_super_admin" &&
    access.client.slug === clientSlug
  ) {
    client = access.client;
  } else {
    if (access.kind === "client_user") redirect(`/${access.client.slug}/home`);
    redirect("/no-access");
  }

  // Filter the switcher list to the 5 most-recently-visited clients
  // (padded with newest if the admin hasn't visited 5 yet). See
  // lib/recent-clients.ts for the cookie-based recency model.
  const recentSlugs = isGlobalSuperAdmin ? await readRecentClientSlugs() : [];

  // "Back to dashboard" always returns to Home — the universal landing tab
  // every client has, no matter which surface (Home/Ads/Socials) the admin came
  // in from. (It used to mirror `from`, but that dropped people back onto
  // Socials/Ads unexpectedly; Home is the predictable, always-present target.)
  // `from` still drives which settings TAB opens below (initialSettingsTab).
  const backHref = `/${client.slug}/home`;

  // Default the settings tab to match where the admin came from: the gear on
  // the Socials dashboard passes ?from=socials → open the Socials tab; every
  // other entry point (Ads dashboard, direct visit) opens the Ads tab. This
  // also keeps the SetupChecklist jumplinks (#credentials/#pipeline/#etl, all
  // Ads-tab anchors) landing on visible sections on a fresh onboarding visit.
  // `from=web` opens the Web & SEO tab; `from=seo` is accepted too (back-compat
  // with the historical /seo route + any old deep links).
  const initialSettingsTab =
    from === "socials" ? "socials" : from === "web" || from === "seo" ? "web" : "ads";

  // RBAC scope gate: which settings tabs this user may manage on THIS
  // client. Global super-admins get both; a scoped local super-admin gets
  // only their granted capabilities. We render ONLY the allowed tabs'
  // sections (not just hide them) so a scoped admin never even
  // server-fetches settings outside their remit. Access management
  // (viewers/domains) and client lifecycle live outside this gate.
  // Settings tabs the user may manage (Ads / Socials / Web & SEO). The "web"
  // capability backs the Web & SEO tab; the `seo` upsell isn't a settings tab of
  // its own (it only adds the dashboard heatmap), so it never appears here.
  const allowedTabs = manageableCapabilities(access, client.id);

  return (
    <>
      {/* Bumps this client to the top of the recents cookie on every
          admin visit. Renders nothing — pure cookie side effect. */}
      <RecentClientTracker slug={client.slug} />
      {/* On-connect "pulling your history…" blocker. Inert unless a social
          backfill is in flight (driven by the ?<platform>_connected=1 OAuth
          return). Anyone who can reach /admin can manage this client. */}
      <SocialBackfillOverlay clientId={client.id} />
      <DashboardHeader
        client={client}
        section="Admin"
        user={{ email: user.email }}
        report={{ clientId: client.id, services: client.enabled_services }}
        // Switcher only renders for global super-admin (they can browse
        // multiple clients). A local super-admin is scoped to one client
        // and shouldn't see a chooser — they'd only see themselves.
        switcher={
          isGlobalSuperAdmin
            ? {
                activeSlug: client.slug,
                clients: orderClientsByRecents(
                  allClientsForSwitcher,
                  recentSlugs,
                ).map((c) => ({
                  slug: c.slug,
                  name: c.name,
                  brand_logo_url: c.brand_logo_url,
                  brand_accent_color: c.brand_accent_color,
                })),
              }
            : undefined
        }
        // We're already on the admin page; the gear becomes a no-op link
        // back to itself, so we just leave it off here.
      />

      {/* Mobile gate — admin is desktop-only per simplified mobile UX.
          Even direct URL navigation hits this banner instead of the
          full settings UI. */}
      <main className="md:hidden w-full px-6 py-10 flex flex-col items-center text-center gap-4">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Admin is desktop-only
        </h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-sm">
          Credentials, access management, and ETL controls aren&apos;t available on mobile.
          Open this page on a laptop or larger screen.
        </p>
        <ProgressLink
          href={backHref}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)]"
        >
          <ArrowLeft size={14} />
          Back to dashboard
        </ProgressLink>
      </main>

      <main className="hidden md:flex w-full px-6 lg:px-12 py-10 flex-col gap-8 lg:mx-auto lg:max-w-[90vw]">
        {/* Demo guard: every section below is a real mutation in the live
            product. This interceptor catches each form submit / OAuth link and
            opens a "how it works" explainer instead of writing to the DB. */}
        <DemoActionInterceptor>
        {/* Title row with back link */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
              Admin
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
              {client.name}
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1.5">
              Credentials, access management, and ETL controls for this client.
            </p>
          </div>
          <ProgressLink
            href={backHref}
            className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-3 py-2 rounded-md hover:bg-[var(--surface-2)] transition-colors"
          >
            <ArrowLeft size={14} />
            Back to dashboard
          </ProgressLink>
        </div>

        {/* Setup checklist — top of page banner that walks a freshly-
            created client through the four onboarding steps. Hides itself
            once everything is green so it doesn't clutter routine visits.
            Wrapped in its own Suspense so the rest of the page paints
            even while the checklist's 5 parallel lookups are in flight.

            ADS-ONLY: three of its four steps (credentials / pipeline / ETL)
            are Meta+Asera setup, and its jumplinks (#credentials/#pipeline/
            #etl) target anchors that live inside the Ads settings tab. A
            client without the Ads product has neither, so we skip the
            checklist entirely for them — their onboarding is just "connect
            accounts" on the Socials tab, which is self-evident there. */}
        {client.enabled_services.includes("ads") && (
          <Suspense fallback={null}>
            <SetupChecklist clientId={client.id} />
          </Suspense>
        )}

        {/* Access section — domains + individual emails allowed to see this
            client. Wrapped in Suspense so the rest of the page paints first.
            id="access" matches the setup-checklist jumplink. */}
        <Suspense fallback={<AccessSkeleton />}>
          <div id="access" data-explain="access">
            <AccessSection clientId={client.id} clientSlug={client.slug} canManageGrants={isGlobalSuperAdmin} />
          </div>
        </Suspense>

        {/* Services entitlement — global-super-admin only. Sits ABOVE the
            settings tabs because it decides which tabs exist: turning a
            product off here collapses its tab out of the toggle below (and
            its dashboard tab for every viewer). Synchronous — enabled_services
            is already on the resolved client, no extra fetch. */}
        {isGlobalSuperAdmin && (
          // `key` ties this control's identity to the client + its persisted
          // services. Saving fires a server action that revalidates /admin and
          // re-renders this page with the new enabled_services; the changed key
          // forces a fresh remount so the checkboxes immediately reflect what
          // was just saved (otherwise React reuses the instance and keeps the
          // pre-save checkbox state until a hard reload). Also resets cleanly
          // when a super-admin switches clients in place via the switcher.
          <div data-explain="services">
            <EnabledServicesSection
              key={`${client.id}:${client.enabled_services.join("+")}`}
              clientId={client.id}
              clientSlug={client.slug}
              enabledServices={client.enabled_services}
            />
          </div>
        )}

        {/* Settings tabs — Ads vs Socials. Access (above) and the
            lifecycle / delete section (below) sit OUTSIDE the tabs and are
            always visible. Scoped RBAC: `allowedTabs` decides which tabs
            this user may manage — a socials-scoped local admin sees only
            the Socials tab (no toggle), an ads-scoped one only Ads, a
            global super-admin both. We pass a node ONLY for allowed tabs,
            so a scoped admin never even server-fetches the other tab. */}
        <AdminSettingsTabs
          initialTab={initialSettingsTab}
          allowedTabs={allowedTabs}
          ads={
            allowedTabs.includes("ads") ? (
            <>
              {/* Credentials — Meta + Asera token storage (Vault-backed). */}
              <Suspense fallback={<CredentialsSkeleton />}>
                <div id="credentials" data-explain="credentials">
                  <CredentialsSection clientId={client.id} clientSlug={client.slug} />
                </div>
              </Suspense>

              {/* Asera Pipeline — discover pipelines, pick one, map stages to phases. */}
              <Suspense fallback={<PipelineSkeleton />}>
                <div id="pipeline" data-explain="pipeline">
                  <PipelineSection clientId={client.id} clientSlug={client.slug} />
                </div>
              </Suspense>

              {/* ETL Status — per-source last run, run-now buttons, backfill. */}
              <Suspense fallback={<EtlSkeleton />}>
                <div id="etl" data-explain="etl">
                  <EtlSection clientId={client.id} clientSlug={client.slug} />
                </div>
              </Suspense>

              {/* Funnel Labels — per-client renames for the four pipeline stages.
                  Sits just above Funnel Goals because the goals section
                  references stage names (Lead → Booking, etc.) and reads more
                  naturally once the admin has confirmed the stage names. */}
              <Suspense fallback={<FunnelLabelsSkeleton />}>
                <div data-explain="funnel-labels">
                  <FunnelLabelsSection clientId={client.id} clientSlug={client.slug} />
                </div>
              </Suspense>

              {/* Funnel Goals — stage-to-stage conversion rate targets used to
                  color the dashboard funnel pills. */}
              <Suspense fallback={<FunnelGoalsSkeleton />}>
                <div data-explain="funnel-goals">
                  <FunnelGoalsSection
                    clientId={client.id}
                    clientSlug={client.slug}
                    labels={client.funnel_labels}
                  />
                </div>
              </Suspense>

              {/*
                Revenue Rules — per-client revenue surcharges (e.g. flat
                $/show consultation fee). Only rendered when the client has
                a non-zero rule configured. Today that's just St. Louis
                Sports Clinic ($67/show); for everyone else the column is
                the default 0 (a math no-op) and the section stays hidden
                so it doesn't clutter the admin page with a meaningless
                card. New clients who need a rule get it set via SQL/seed
                (or future expansion of the new-client form), which makes
                the section appear on the next admin visit.
              */}
              {client.revenue_per_show > 0 && (
                <Suspense fallback={<RevenueRulesSkeleton />}>
                  <div data-explain="revenue">
                    <RevenueRulesSection
                      clientId={client.id}
                      clientSlug={client.slug}
                      initialRevenuePerShow={client.revenue_per_show}
                    />
                  </div>
                </Suspense>
              )}
            </>
            ) : null
          }
          socials={
            allowedTabs.includes("socials") ? (
            <>
              {/* Social Accounts — Meta (FB + IG) OAuth for the Socials module.
                  Future LinkedIn / TikTok / YouTube connect blocks slot in here. */}
              <Suspense fallback={<SocialCredentialsSkeleton />}>
                <div id="social-credentials" data-explain="social-oauth">
                  <SocialCredentialsSection clientId={client.id} clientSlug={client.slug} />
                </div>
              </Suspense>
            </>
            ) : null
          }
          web={
            allowedTabs.includes("web") ? (
              <Suspense fallback={<div className="ps-skeleton h-64 w-full rounded-[var(--radius-card)]" />}>
                <div id="seo-settings" data-explain="seo-settings">
                  <SeoSettingsLoader clientId={client.id} clientSlug={client.slug} hasSeo={client.enabled_services.includes("seo")} hasAds={client.enabled_services.includes("ads")} />
                </div>
              </Suspense>
            ) : null
          }
        />

        {/* Client status / lifecycle — Pause / Delete / Restore /
            Permanently delete. Buttons shown depend on current status.
            Bottom-of-page by convention (you scroll past everything
            else first), synchronous because all the data needed is
            already on hand. */}
        <div data-explain="lifecycle">
          <ClientStatusSection
            clientId={client.id}
            clientName={client.name}
            clientSlug={client.slug}
            status={client.status}
            canManage={isGlobalSuperAdmin}
          />
        </div>
        </DemoActionInterceptor>
      </main>
    </>
  );
}

function AccessSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div className="ps-skeleton h-6 w-20 rounded-md" />
      <div className="ps-skeleton h-3 w-3/4 rounded-md opacity-60" />
      <div className="ps-skeleton h-10 w-full rounded-md mt-3" />
      <div className="ps-skeleton h-10 w-full rounded-md" />
    </section>
  );
}

function CredentialsSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div className="ps-skeleton h-6 w-32 rounded-md" />
      <div className="ps-skeleton h-3 w-2/3 rounded-md opacity-60" />
      <div className="grid gap-5 md:grid-cols-2 mt-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-5 flex flex-col gap-3"
          >
            <div className="ps-skeleton h-5 w-32 rounded-md" />
            <div className="ps-skeleton h-10 w-full rounded-md" />
            <div className="ps-skeleton h-10 w-full rounded-md" />
            <div className="ps-skeleton h-10 w-full rounded-md" />
          </div>
        ))}
      </div>
    </section>
  );
}

function PipelineSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div className="ps-skeleton h-6 w-36 rounded-md" />
      <div className="ps-skeleton h-3 w-3/4 rounded-md opacity-60" />
      <div className="ps-skeleton h-32 w-full rounded-md mt-3" />
    </section>
  );
}

function SocialCredentialsSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div className="ps-skeleton h-6 w-36 rounded-md" />
      <div className="ps-skeleton h-3 w-3/4 rounded-md opacity-60" />
      <div className="ps-skeleton h-20 w-full rounded-md mt-3" />
    </section>
  );
}

function RevenueRulesSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div className="ps-skeleton h-6 w-32 rounded-md" />
      <div className="ps-skeleton h-3 w-3/4 rounded-md opacity-60" />
      <div className="grid gap-4 md:grid-cols-2 max-w-2xl mt-3">
        <div className="flex flex-col gap-2">
          <div className="ps-skeleton h-3 w-32 rounded-md opacity-60" />
          <div className="ps-skeleton h-10 w-full rounded-md" />
        </div>
      </div>
    </section>
  );
}

function FunnelLabelsSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div className="ps-skeleton h-6 w-32 rounded-md" />
      <div className="ps-skeleton h-3 w-3/4 rounded-md opacity-60" />
      <div className="grid gap-4 md:grid-cols-2 max-w-2xl mt-3">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="ps-skeleton h-3 w-20 rounded-md opacity-60" />
            <div className="ps-skeleton h-10 w-full rounded-md" />
          </div>
        ))}
      </div>
    </section>
  );
}

function FunnelGoalsSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div className="ps-skeleton h-6 w-32 rounded-md" />
      <div className="ps-skeleton h-3 w-3/4 rounded-md opacity-60" />
      <div className="grid gap-4 md:grid-cols-3 mt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="ps-skeleton h-3 w-24 rounded-md opacity-60" />
            <div className="ps-skeleton h-10 w-full rounded-md" />
          </div>
        ))}
      </div>
    </section>
  );
}

function EtlSkeleton() {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div className="ps-skeleton h-6 w-28 rounded-md" />
      <div className="ps-skeleton h-3 w-2/3 rounded-md opacity-60" />
      <div className="flex flex-col gap-3 mt-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-5 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="ps-skeleton h-4 w-48 rounded-md" />
              <div className="ps-skeleton h-4 w-32 rounded-md" />
            </div>
            <div className="ps-skeleton h-9 w-40 rounded-md self-end" />
          </div>
        ))}
      </div>
    </section>
  );
}
