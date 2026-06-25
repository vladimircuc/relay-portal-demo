"use client";

/**
 * Local-admins editor for the create-client form — the onboarding twin of
 * the Settings → Access section's email list.
 *
 * Each row grants one email either:
 *   - Viewer            → read-only (scopes stored as null; what they SEE is
 *                         gated by the client's enabled_services at read time)
 *   - Local super-admin → can manage the ticked services (Ads / Socials)
 *
 * Mirrors components/admin/add-allowed-email-form.tsx + editable-scopes.tsx:
 * the capability checkboxes only appear for a Local super-admin row, and a
 * Local super-admin needs ≥1 service ticked (the server re-validates). The
 * create screen is super-admin-only, so minting local super-admins is allowed
 * here without the extra `canManageGrants` gate Settings applies.
 *
 * Serialization: this is an inherently interactive (add/remove rows) control,
 * so unlike the rest of the form it needs JS. The non-empty rows are
 * JSON-encoded into a single hidden `local_admins` input that the createClient
 * server action parses + re-validates. State lives here and survives a failed
 * submit because useActionState keeps the parent form instance mounted — the
 * `initial` prop only seeds the first mount (and the JS-disabled re-render).
 */
import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Capability } from "@/lib/auth";

export type LocalAdminDraft = {
  email: string;
  role: "viewer" | "local_super_admin";
  scopes: Capability[];
};

const INPUT_CLS =
  "bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--ps-yellow)]";

const SELECT_CLS =
  "bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--ps-yellow)]";

/** A fresh row defaults to a fully-scoped local super-admin — the common
 *  onboarding case ("here's the person who runs this client"). Flip to Viewer
 *  or untick a service per row. */
function emptyRow(): LocalAdminDraft {
  return { email: "", role: "local_super_admin", scopes: ["ads", "socials", "web"] };
}

export function LocalAdminsField({ initial }: { initial: LocalAdminDraft[] }) {
  const [rows, setRows] = useState<LocalAdminDraft[]>(initial);

  // Encode the non-empty rows for the server action. Empty-email rows are
  // dropped so a half-typed-then-cleared row doesn't post; the server
  // re-validates email shape + the ≥1-scope rule for local super-admins.
  const serialized = JSON.stringify(
    rows
      .map((r) => ({ ...r, email: r.email.trim() }))
      .filter((r) => r.email !== ""),
  );

  function patch(i: number, next: Partial<LocalAdminDraft>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...next } : r)));
  }

  function toggleScope(i: number, cap: Capability) {
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        const has = r.scopes.includes(cap);
        return {
          ...r,
          scopes: has ? r.scopes.filter((c) => c !== cap) : [...r.scopes, cap],
        };
      }),
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* The whole control reduces to this one field for the server action. */}
      <input type="hidden" name="local_admins" value={serialized} />

      {rows.map((row, i) => {
        const isLsa = row.role === "local_super_admin";
        const noScope = isLsa && row.scopes.length === 0;
        return (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-md border border-[var(--surface-3)]/40 bg-[var(--surface-1)]/40 p-2.5"
          >
            <div className="grid grid-cols-1 md:grid-cols-[2fr_1.5fr_auto] gap-2">
              <input
                type="email"
                value={row.email}
                onChange={(e) => patch(i, { email: e.target.value })}
                placeholder="owner@example.com"
                autoComplete="off"
                className={INPUT_CLS}
              />
              <select
                value={row.role}
                onChange={(e) =>
                  patch(i, {
                    role:
                      e.target.value === "viewer" ? "viewer" : "local_super_admin",
                  })
                }
                className={SELECT_CLS}
              >
                <option value="viewer">Viewer</option>
                <option value="local_super_admin">Local super-admin</option>
              </select>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                aria-label="Remove this admin"
                className="inline-flex items-center justify-center h-9 w-9 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Capability scopes — only for local super-admin rows. ≥1 required
                (the createClient action re-checks). */}
            {isLsa && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 rounded-md bg-[var(--surface-2)]/50 border border-[var(--surface-3)]/40">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                  Can manage:
                </span>
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={row.scopes.includes("ads")}
                    onChange={() => toggleScope(i, "ads")}
                    className="accent-[var(--ps-yellow)]"
                  />
                  Ads
                </label>
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={row.scopes.includes("socials")}
                    onChange={() => toggleScope(i, "socials")}
                    className="accent-[var(--ps-yellow)]"
                  />
                  Socials
                </label>
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-primary)] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={row.scopes.includes("web")}
                    onChange={() => toggleScope(i, "web")}
                    className="accent-[var(--ps-yellow)]"
                  />
                  Web &amp; SEO
                </label>
                <span
                  className={
                    noScope
                      ? "text-[11px] text-[var(--negative)]"
                      : "text-[11px] text-[var(--text-tertiary)]"
                  }
                >
                  {noScope
                    ? "Pick at least one to grant (or set to Viewer)."
                    : "They’ll only see & manage the tabs you allow."}
                </span>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, emptyRow()])}
        className="inline-flex items-center gap-1.5 self-start px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] border border-dashed border-[var(--surface-3)]/60 hover:text-[var(--text-primary)] hover:border-[var(--ps-yellow)]/60 transition-colors"
      >
        <Plus size={14} />
        {rows.length === 0 ? "Add a local admin" : "Add another"}
      </button>
    </div>
  );
}
