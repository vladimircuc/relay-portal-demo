"use client";

/**
 * Inline capability-scope editor for an existing local_super_admin row in
 * the Access section. Renders ONLY for global super-admins (the Access
 * section passes it in place of the static scope badges when
 * `canManageGrants`); local admins see the read-only chips instead.
 *
 * Three checkboxes (Ads / Socials / Web & SEO) + a Save button that appears
 * only once the selection differs from what's persisted. Disabled when nothing
 * is ticked — a local super-admin with zero capabilities is meaningless, and
 * the server (updateAllowedEmailScopes) rejects it too.
 *
 * "Web & SEO" is the single `web` capability — it governs the whole Web & SEO
 * tab + settings (the `seo` upsell is a client entitlement, never a per-user
 * scope). A NULL scopes value (the legacy pre-027 "all access" grant) shows
 * every box ticked; saving converts it to an explicit list.
 *
 * Baseline tracking: after a successful save we advance the saved-state to
 * match, so the Save button collapses again without depending on the
 * parent re-render to remount us.
 */
import { useState } from "react";
import { updateAllowedEmailScopes } from "./access-actions";
import { SubmitPrimary } from "./submit-button";
import type { Capability } from "@/lib/auth";

export function EditableScopes({
  id,
  clientSlug,
  scopes,
}: {
  id: string;
  clientSlug: string;
  scopes: Capability[] | null;
}) {
  const baseAds = scopes === null || scopes.includes("ads");
  const baseSocials = scopes === null || scopes.includes("socials");
  const baseWeb = scopes === null || scopes.includes("web");

  const [ads, setAds] = useState(baseAds);
  const [socials, setSocials] = useState(baseSocials);
  const [web, setWeb] = useState(baseWeb);
  // What's currently persisted — advanced on a successful save so `dirty`
  // resets and the Save button hides again.
  const [savedAds, setSavedAds] = useState(baseAds);
  const [savedSocials, setSavedSocials] = useState(baseSocials);
  const [savedWeb, setSavedWeb] = useState(baseWeb);

  const dirty = ads !== savedAds || socials !== savedSocials || web !== savedWeb;
  const valid = ads || socials || web;

  async function handleSave(formData: FormData) {
    await updateAllowedEmailScopes(formData);
    setSavedAds(ads);
    setSavedSocials(socials);
    setSavedWeb(web);
  }

  return (
    <form action={handleSave} className="flex items-center gap-x-3 gap-y-1 flex-wrap">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="clientSlug" value={clientSlug} />
      <label className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] cursor-pointer select-none">
        <input
          type="checkbox"
          name="scopes"
          value="ads"
          checked={ads}
          onChange={(e) => setAds(e.target.checked)}
          className="accent-[var(--ps-yellow)]"
        />
        Ads
      </label>
      <label className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] cursor-pointer select-none">
        <input
          type="checkbox"
          name="scopes"
          value="socials"
          checked={socials}
          onChange={(e) => setSocials(e.target.checked)}
          className="accent-[var(--ps-yellow)]"
        />
        Socials
      </label>
      <label className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)] cursor-pointer select-none">
        <input
          type="checkbox"
          name="scopes"
          value="web"
          checked={web}
          onChange={(e) => setWeb(e.target.checked)}
          className="accent-[var(--ps-yellow)]"
        />
        Web &amp; SEO
      </label>
      {dirty && (
        <SubmitPrimary
          pendingLabel="Saving…"
          disabled={!valid}
          className="px-2.5 py-1 text-[11px] min-w-0"
        >
          Save
        </SubmitPrimary>
      )}
    </form>
  );
}
