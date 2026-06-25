"use client";

/**
 * Add-email form for the Access section. Split out of access-section.tsx
 * because it needs client state: the capability scope checkboxes only
 * appear once you pick the "Local super-admin" role.
 *
 * The role selector + scope checkboxes render ONLY when `canManageGrants`
 * (i.e. the viewer is a global super-admin). For a local super-admin the
 * form collapses to email + note + Add — they can only mint viewers, and
 * the server action (addAllowedEmail) re-enforces that regardless of what
 * the form posts.
 *
 * State note: React 19 auto-resets the <form> after a successful action,
 * which snaps the uncontrolled email/note inputs (and the native <select>'s
 * DOM value) back to their defaults. But our React state (`role`, and the
 * controlled scope checkboxes) ISN'T touched by that reset — so without an
 * explicit reset the scope row would linger on screen with the dropdown
 * visually back on "Viewer". `handleAdd` resets our state once the insert
 * resolves; if it throws we skip the reset so the admin can fix + resubmit.
 */
import { useState } from "react";
import { addAllowedEmail } from "./access-actions";
import { SubmitPrimary } from "./submit-button";

const INPUT_CLS =
  "bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--ps-yellow)]";

export function AddAllowedEmailForm({
  clientId,
  clientSlug,
  canManageGrants,
}: {
  clientId: string;
  clientSlug: string;
  canManageGrants: boolean;
}) {
  const [role, setRole] = useState<"viewer" | "local_super_admin">("viewer");
  // Controlled so we can (a) disable Add when nothing's ticked and
  // (b) reset them cleanly after a successful submit.
  const [ads, setAds] = useState(true);
  const [socials, setSocials] = useState(true);
  const [web, setWeb] = useState(true);

  const showScopes = canManageGrants && role === "local_super_admin";
  const noScopeChosen = showScopes && !ads && !socials && !web;

  async function handleAdd(formData: FormData) {
    await addAllowedEmail(formData);
    // Success — bring our React state back in line with the auto-reset
    // DOM so the scope row collapses and the dropdown reads "Viewer".
    setRole("viewer");
    setAds(true);
    setSocials(true);
    setWeb(true);
  }

  return (
    <form action={handleAdd} className="flex flex-col gap-2 mt-1">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="clientSlug" value={clientSlug} />

      <div
        className={
          canManageGrants
            ? "grid grid-cols-1 md:grid-cols-[2fr_1.5fr_auto_auto] gap-2"
            : "grid grid-cols-1 md:grid-cols-[2fr_1.5fr_auto] gap-2"
        }
      >
        <input
          name="email"
          type="email"
          placeholder="person@example.com"
          required
          autoComplete="off"
          className={INPUT_CLS}
        />
        <input
          name="note"
          placeholder="Note (optional)"
          autoComplete="off"
          className={INPUT_CLS}
        />
        {canManageGrants && (
          <select
            name="role"
            value={role}
            onChange={(e) =>
              setRole(e.target.value === "local_super_admin" ? "local_super_admin" : "viewer")
            }
            className="bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--ps-yellow)]"
          >
            <option value="viewer">Viewer</option>
            <option value="local_super_admin">Local super-admin</option>
          </select>
        )}
        {/* Disabled (not just server-rejected) when an LSA grant has no
            capability ticked — there's nothing valid to submit. */}
        <SubmitPrimary pendingLabel="Adding…" disabled={noScopeChosen}>
          Add
        </SubmitPrimary>
      </div>

      {/* Capability scopes — only for local_super_admin grants, which only
          global super-admins can create. ≥1 required (server re-checks). */}
      {showScopes && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 rounded-md bg-[var(--surface-2)]/50 border border-[var(--surface-3)]/40">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">Can manage:</span>
          <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)] cursor-pointer select-none">
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
          <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)] cursor-pointer select-none">
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
          <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)] cursor-pointer select-none">
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
          <span
            className={
              noScopeChosen
                ? "text-[11px] text-[var(--negative)]"
                : "text-[11px] text-[var(--text-tertiary)]"
            }
          >
            {noScopeChosen
              ? "Pick at least one to add."
              : "Pick at least one. They’ll only see & edit the tabs you allow."}
          </span>
        </div>
      )}
    </form>
  );
}
