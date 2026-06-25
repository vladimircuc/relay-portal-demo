"use client";

/**
 * Client tab wrapper for the MIDDLE of the /admin settings page.
 *
 * The Access section (top) and the Client status / lifecycle section
 * (bottom) live OUTSIDE this wrapper and are always visible. Everything
 * in between is split into two mutually-exclusive tabs:
 *   - Ads     → ad-account + CRM credentials, pipeline mapping, ETL,
 *               funnel labels / goals, revenue rules.
 *   - Socials → connected social accounts (the /socials module).
 *
 * Same RSC-as-props trick as <SocialsBoard>: both groups are server-
 * rendered and passed in as `ads` / `socials` nodes (each keeps its own
 * <Suspense> streaming). We just toggle which group is visible client-
 * side — the inactive group stays mounted but hidden, so switching is
 * instant and nothing re-fetches.
 *
 * Scoped RBAC: the page passes `allowedTabs` (from manageableCapabilities)
 * so a socials-scoped local super-admin sees only the Socials tab, an
 * ads-scoped one only the Ads tab (with no toggle), and a global
 * super-admin sees both. Tabs outside the grant aren't rendered at all —
 * the page omits their node, so nothing forbidden is server-fetched.
 */
import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";

export type SettingsTab = "ads" | "socials" | "web";

const TAB_OPTIONS = [
  { value: "ads" as const, label: "Ads" },
  { value: "socials" as const, label: "Socials" },
  { value: "web" as const, label: "Web & SEO" },
];

const TAB_DESC: Record<SettingsTab, string> = {
  ads: "Ad accounts, CRM pipeline, funnel & revenue settings.",
  socials: "Social accounts connected to the Socials dashboard.",
  web: "Search Console / GA4 / Bing connection, backfill, and AI uploads.",
};

export function AdminSettingsTabs({
  initialTab,
  allowedTabs,
  ads,
  socials,
  web,
}: {
  initialTab: SettingsTab;
  /** Capabilities this user may manage on this client (from
   *  manageableCapabilities). Drives which tabs render + whether the
   *  toggle shows. The page passes a node only for tabs in this list. */
  allowedTabs: SettingsTab[];
  ads?: React.ReactNode;
  socials?: React.ReactNode;
  web?: React.ReactNode;
}) {
  // Offer only the tabs this user is allowed to manage.
  const options = TAB_OPTIONS.filter((o) => allowedTabs.includes(o.value));
  const fallback: SettingsTab = options[0]?.value ?? "ads";
  const safeInitial = allowedTabs.includes(initialTab) ? initialTab : fallback;
  const [tab, setTab] = useState<SettingsTab>(safeInitial);

  // Degenerate zero-capability grant: render nothing here. Access
  // management lives outside this wrapper, so the page stays useful.
  if (options.length === 0) return null;

  const showToggle = options.length > 1;

  return (
    <div className="flex flex-col gap-8">
      {/* Tab bar — hidden for a single-scope admin (only one tab to show). */}
      {showToggle && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented<SettingsTab> value={tab} options={options} onChange={setTab} />
          <span className="text-[12px] text-[var(--text-tertiary)]">{TAB_DESC[tab]}</span>
        </div>
      )}

      {/* Both groups stay mounted; the inactive one is display:none. `contents`
          lets the active group's sections inherit this column's gap-8 spacing
          (same approach as SocialsBoard's Advanced block). */}
      <div className={tab === "ads" ? "contents" : "hidden"} aria-hidden={tab !== "ads"}>
        {ads}
      </div>
      <div className={tab === "socials" ? "contents" : "hidden"} aria-hidden={tab !== "socials"}>
        {socials}
      </div>
      <div className={tab === "web" ? "contents" : "hidden"} aria-hidden={tab !== "web"}>
        {web}
      </div>
    </div>
  );
}
