"use client";

/**
 * Per-client Services section on the /admin page — global-super-admin only.
 *
 * Flips which products (Ads / Socials / Web / SEO) the client is entitled to.
 * Mirrors the EditableScopes pattern: accent-yellow checkboxes + a Save button
 * that only appears once the selection differs from what's persisted, disabled
 * when nothing is ticked (the server rejects an empty set too).
 *
 * Web & SEO is two entitlements with an upsell relationship: `web` is the base
 * product (drives the Web & SEO tab + settings), `seo` is an upsell that ADDS
 * the Local heatmap section. seo ⟹ web — ticking SEO auto-enables Web, and
 * unticking Web clears SEO. The server (updateEnabledServices) re-enforces it.
 *
 * Why this matters: enabled_services is the single source of truth for which
 * dashboard tabs render and which /admin capability tabs are manageable.
 */
import { useState } from "react";
import { updateEnabledServices } from "./enabled-services-actions";
import { SubmitPrimary } from "./submit-button";
import type { Service } from "@/lib/auth";

export function EnabledServicesSection({
  clientId,
  clientSlug,
  enabledServices,
}: {
  clientId: string;
  clientSlug: string;
  enabledServices: Service[];
}) {
  const baseAds = enabledServices.includes("ads");
  const baseSocials = enabledServices.includes("socials");
  const baseWeb = enabledServices.includes("web");
  const baseSeo = enabledServices.includes("seo");

  const [ads, setAds] = useState(baseAds);
  const [socials, setSocials] = useState(baseSocials);
  const [web, setWeb] = useState(baseWeb);
  const [seo, setSeo] = useState(baseSeo);
  // What's currently persisted — advanced on a successful save so `dirty`
  // resets and the Save button hides again. (After a save the parent also
  // remounts us via a `key` tied to the persisted services — see admin/page —
  // so these line up with the fresh prop on the next render either way.)
  const [savedAds, setSavedAds] = useState(baseAds);
  const [savedSocials, setSavedSocials] = useState(baseSocials);
  const [savedWeb, setSavedWeb] = useState(baseWeb);
  const [savedSeo, setSavedSeo] = useState(baseSeo);

  // seo ⟹ web: ticking SEO turns Web on; unticking Web turns SEO off.
  const toggleWeb = (checked: boolean) => {
    setWeb(checked);
    if (!checked) setSeo(false);
  };
  const toggleSeo = (checked: boolean) => {
    setSeo(checked);
    if (checked) setWeb(true);
  };

  const dirty = ads !== savedAds || socials !== savedSocials || web !== savedWeb || seo !== savedSeo;
  // Web alone is a valid product; SEO without Web can't happen (toggleSeo).
  const valid = ads || socials || web;

  async function handleSave(formData: FormData) {
    await updateEnabledServices(formData);
    setSavedAds(ads);
    setSavedSocials(socials);
    setSavedWeb(web);
    setSavedSeo(seo);
  }

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Services</h2>
        <p className="text-[13px] text-[var(--text-secondary)] mt-1 max-w-2xl">
          Which products this client is entitled to. Controls which dashboard
          tabs they see (Home is always shown) and which settings tabs can be
          managed. SEO is an upsell on top of Web — ticking it enables Web too,
          and adds the Local heatmap to the Web &amp; SEO tab.
        </p>
      </div>

      <form action={handleSave} className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="clientSlug" value={clientSlug} />
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
          <input
            type="checkbox"
            name="enabled_services"
            value="ads"
            checked={ads}
            onChange={(e) => setAds(e.target.checked)}
            className="accent-[var(--ps-yellow)] h-4 w-4"
          />
          Ads
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
          <input
            type="checkbox"
            name="enabled_services"
            value="socials"
            checked={socials}
            onChange={(e) => setSocials(e.target.checked)}
            className="accent-[var(--ps-yellow)] h-4 w-4"
          />
          Socials
        </label>
        {/* Web + SEO grouped — the Web & SEO product, with the SEO upsell. */}
        <span className="flex items-center gap-x-4 pl-1 border-l border-[var(--surface-3)]/50">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              name="enabled_services"
              value="web"
              checked={web}
              onChange={(e) => toggleWeb(e.target.checked)}
              className="accent-[var(--ps-yellow)] h-4 w-4"
            />
            Web
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              name="enabled_services"
              value="seo"
              checked={seo}
              onChange={(e) => toggleSeo(e.target.checked)}
              className="accent-[var(--ps-yellow)] h-4 w-4"
            />
            SEO <span className="text-[11px] text-[var(--text-tertiary)]">(adds heatmap)</span>
          </label>
        </span>
        {!valid && (
          <span className="text-[11px] text-[var(--negative)]">Pick at least one.</span>
        )}
        {dirty && (
          <SubmitPrimary
            pendingLabel="Saving…"
            disabled={!valid}
            className="px-3 py-1.5 text-[12px]"
          >
            Save
          </SubmitPrimary>
        )}
      </form>
    </section>
  );
}
