/**
 * Home-tab overview — the client's orientation + growth page.
 *
 *   1. Premium hero       → what this is (adapts agency vs. client view)
 *   2. "Your dashboard"   → one card per ENABLED product (what you can see)
 *   3. "Grow with us"     → one card per product the client does NOT have yet
 *                           (what it is, why it helps, how to get it) — the
 *                           always-present, no-pressure upsell surface
 *   4. Manage card        → /admin (write-access viewers only)
 *   5. Refresh footnote
 *
 * No data fetching — renders instantly. Copy + icons come from SERVICE_CATALOG
 * so the home cards and the locked tabs stay in lockstep.
 */
import { Settings, ArrowRight, Clock, Check, Lock } from "lucide-react";
import type { Capability } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { ProgressLink } from "./progress-link";
import { PRODUCT_ROUTE } from "./section-nav";
import { SERVICE_CATALOG, type ServiceMeta } from "./service-catalog";

const ALL: Capability[] = ["ads", "socials", "web"];

export function HomeOverview({
  clientName,
  slug,
  sections,
  canManageThisClient,
  isAgencyViewer,
}: {
  clientName: string;
  slug: string;
  /** The client's entitled product tabs (visibleSections). */
  sections: Capability[];
  canManageThisClient: boolean;
  isAgencyViewer: boolean;
}) {
  const owned = ALL.filter((c) => sections.includes(c));
  const unowned = ALL.filter((c) => !sections.includes(c));
  const hasAds = owned.includes("ads");
  const hasSocials = owned.includes("socials");
  const gridCols = (n: number) => (n >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : n === 2 ? "sm:grid-cols-2" : "");

  return (
    <main className="w-[92vw] lg:w-[75vw] max-w-[1100px] mx-auto py-8 md:py-12 flex flex-col gap-8 md:gap-10">
      {/* ── Premium hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--surface-3)]/50 bg-[var(--surface-1)] p-7 sm:p-9">
        <span aria-hidden className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,209,0,0.12), transparent 70%)" }} />
        <div className="relative flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--surface-3)]/60 bg-[var(--surface-0)]/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--ps-yellow)]" />
            Dashboard
          </span>
          <h1 className="text-3xl sm:text-[2.6rem] font-bold tracking-tight text-[var(--text-primary)] leading-[1.05]">
            {clientName}
          </h1>
          <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed max-w-2xl">
            {isAgencyViewer
              ? `Everything Relay is tracking for ${clientName}. Use the tabs above to open each area — pick a date range inside any tab to explore a period.`
              : "Welcome — this is your live reporting dashboard. Everything we track for you lives behind the tabs above. Open one to dive in, and pick a date range inside it to explore any period. Your numbers update automatically."}
          </p>
        </div>
      </section>

      {/* ── Your dashboard: enabled products ─────────────────────────────── */}
      {owned.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] font-medium">Your dashboard</h2>
          <div className={cn("grid gap-4", gridCols(owned.length))}>
            {owned.map((s) => <OwnedCard key={s} slug={slug} service={s} meta={SERVICE_CATALOG[s]} />)}
          </div>
        </section>
      )}

      {/* ── Grow with Relay: services not on the plan yet ────────── */}
      {unowned.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] font-medium">Grow with Relay</h2>
            <p className="text-[13px] text-[var(--text-secondary)]">
              More ways we can help {isAgencyViewer ? clientName : "you"} grow — ready to add to this dashboard whenever you are.
            </p>
          </div>
          <div className={cn("grid gap-4", gridCols(unowned.length))}>
            {unowned.map((s) => <UpsellCard key={s} meta={SERVICE_CATALOG[s]} />)}
          </div>
        </section>
      )}

      {/* ── Manage card — write-access viewers only ──────────────────────── */}
      {canManageThisClient && (
        <ProgressLink
          href={`/${slug}/admin?from=home`}
          // Admin is desktop-only (the /admin page gates mobile out), so hide the
          // entry point on phones entirely.
          className="group hidden md:flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-5 hover:border-[var(--ps-yellow)]/50 transition-colors"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[var(--accent-fg)]">
            <Settings size={20} />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">Manage this client</span>
            <span className="text-[13px] text-[var(--text-secondary)]">Connect accounts, edit funnel labels and goals, manage access, and configure data sources.</span>
          </div>
          <ArrowRight size={16} className="ml-auto shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--text-primary)]" />
        </ProgressLink>
      )}

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--surface-3)]/30 bg-[var(--surface-1)]/50 p-5">
        <Clock size={16} className="mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
        <p className="text-[12px] text-[var(--text-tertiary)] leading-relaxed">
          {hasAds && hasSocials
            ? "Ads data refreshes on demand and at least once a day; Socials pulls automatically every day. "
            : hasAds
              ? "Ads data refreshes on demand and at least once a day. "
              : hasSocials
                ? "Socials data pulls automatically every day. "
                : ""}
          History is stored, never overwritten — so you can always look back at any past period.
        </p>
      </section>
    </main>
  );
}

/** Enabled product — icon chip, blurb, feature bullets, open link. */
function OwnedCard({ slug, service, meta }: { slug: string; service: Capability; meta: ServiceMeta }) {
  const Icon = meta.icon;
  return (
    <ProgressLink
      href={`/${slug}/${PRODUCT_ROUTE[service]}`}
      className="group flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-6 hover:border-[var(--ps-yellow)]/50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--accent-fg)]">
          <Icon size={22} />
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{meta.navLabel}</h3>
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{meta.blurb}</p>
      <ul className="flex flex-col gap-1.5 mt-1">
        {meta.features.map((b) => (
          <li key={b} className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
            <Check size={14} className="mt-0.5 shrink-0 text-[var(--accent-fg)]" />
            {b}
          </li>
        ))}
      </ul>
      <span className="inline-flex items-center gap-1.5 mt-2 text-[13px] font-semibold text-[var(--text-primary)]">
        Open {meta.navLabel}
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </ProgressLink>
  );
}

/** Not-on-plan product — aspirational card: locked icon, pitch, benefits, and a
 *  plain "ask us" line (no link). Dashed border signals "available to add". */
function UpsellCard({ meta }: { meta: ServiceMeta }) {
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-dashed border-[var(--surface-3)]/70 bg-[var(--surface-1)]/50 p-6 transition-colors hover:border-[var(--ps-yellow)]/45">
      <div className="flex items-center gap-3">
        <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--ps-yellow)]/10 border border-[var(--ps-yellow)]/30 text-[var(--accent-fg)]">
          <Icon size={20} />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--surface-0)] border border-[var(--surface-3)]">
            <Lock size={10} className="text-[var(--accent-fg)]" strokeWidth={2.5} />
          </span>
        </div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">{meta.label}</h3>
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{meta.pitch}</p>
      <ul className="flex flex-col gap-1.5 mt-1">
        {meta.benefits.map((b) => (
          <li key={b} className="flex items-start gap-2 text-[13px] text-[var(--text-secondary)]">
            <Check size={14} className="mt-0.5 shrink-0 text-[var(--accent-fg)]" />
            {b}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-3 text-[12.5px] text-[var(--text-tertiary)] border-t border-[var(--surface-3)]/30">
        Contact your Relay representative to add {meta.navLabel}.
      </div>
    </div>
  );
}
