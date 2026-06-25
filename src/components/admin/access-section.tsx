/**
 * Per-client Access section — lists currently-allowed email domains and
 * individual emails, with inline add/remove forms.
 *
 * Two access shapes:
 *   - Email domains: broad allowlist (anyone @company.com gets in).
 *     Always read-only (viewer). Domains are too broad to elevate.
 *   - Individual emails: per-email allowlist with a per-row role.
 *     - viewer: same as a domain-matched user (dashboard read access only)
 *     - local_super_admin: viewer + can write to this client's /admin
 *       page (credentials, pipeline, access lists, ETL, funnel goals,
 *       client status). Same scope as a global super-admin, just bound
 *       to one client.
 *
 * Mutations happen via the server actions in access-actions.ts. Viewer +
 * domain grants need only local-admin rights; minting or revoking a
 * local_super_admin (and its capability scopes) is global-super-admin-
 * only. The `canManageGrants` prop mirrors that split in the UI: it's
 * true only for global super-admins, who alone see the role selector,
 * the scope checkboxes, and the remove button on local_super_admin rows.
 */
import { Globe, Mail, Trash2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import type { Capability } from "@/lib/auth";
import { addDomain, removeDomain, removeAllowedEmail } from "./access-actions";
import { AddAllowedEmailForm } from "./add-allowed-email-form";
import { EditableScopes } from "./editable-scopes";
import { SubmitPrimary, SubmitIcon } from "./submit-button";

type Props = {
  clientId: string;
  clientSlug: string;
  /** True only for global super-admins. Gates the local_super_admin
   *  grant controls (role selector, scope checkboxes, LSA-row removal). */
  canManageGrants: boolean;
};

type DomainRow = { id: string; email_domain: string; created_at: string };
type EmailRow = {
  id: string;
  email: string;
  note: string | null;
  role: "viewer" | "local_super_admin";
  scopes: Capability[] | null;
  created_at: string;
};

/** Human labels for a local_super_admin's capability scopes. NULL (the
 *  legacy unscoped grant) → a single "All access" chip. */
function scopeBadges(scopes: Capability[] | null): string[] {
  if (scopes === null) return ["All access"];
  const labels: string[] = [];
  if (scopes.includes("ads")) labels.push("Ads");
  if (scopes.includes("socials")) labels.push("Socials");
  if (scopes.includes("web")) labels.push("Web & SEO");
  return labels.length > 0 ? labels : ["No access"];
}

export async function AccessSection({ clientId, clientSlug, canManageGrants }: Props) {
  const supabase = createAdminClient();
  const [{ data: domains }, { data: emails }] = await Promise.all([
    supabase
      .from("client_domains")
      .select("id, email_domain, created_at")
      .eq("client_id", clientId)
      .order("email_domain", { ascending: true }),
    supabase
      .from("client_allowed_emails")
      .select("id, email, note, role, scopes, created_at")
      .eq("client_id", clientId)
      .order("email", { ascending: true }),
  ]);

  const domainRows = (domains as DomainRow[] | null) ?? [];
  const emailRows = (emails as EmailRow[] | null) ?? [];

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Access</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Anyone whose email matches a domain below — OR who is listed individually — can sign in
          and view this client&apos;s dashboard.
          {canManageGrants && (
            <>
              {" "}Promote an individual to <strong>Local super-admin</strong> to also give them
              write access to a slice of this settings page (Ads and/or Socials).
            </>
          )}
        </p>
      </div>

      {/* ── Email domains ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-[var(--text-tertiary)]" />
          <h3 className="text-xs uppercase tracking-[0.12em] text-[var(--text-tertiary)] font-medium">
            Email domains
          </h3>
        </div>

        {domainRows.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)] italic">
            No domains added yet. Add one below — e.g. <code>varbleorthodontics.com</code>.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {domainRows.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[var(--surface-2)]/60 border border-[var(--surface-3)]/40"
              >
                <span className="text-sm font-medium text-[var(--text-primary)] tabular-nums">
                  {d.email_domain}
                </span>
                <form action={removeDomain}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="clientSlug" value={clientSlug} />
                  <SubmitIcon aria-label={`Remove ${d.email_domain}`}>
                    <Trash2 size={14} />
                  </SubmitIcon>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form
          action={addDomain}
          className="flex items-center gap-2 mt-1"
        >
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="clientSlug" value={clientSlug} />
          <input
            name="domain"
            placeholder="example.com"
            required
            autoComplete="off"
            className="flex-1 bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--ps-yellow)]"
          />
          <SubmitPrimary pendingLabel="Adding…">Add</SubmitPrimary>
        </form>
      </div>

      {/* ── Individual emails ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 pt-2 border-t border-[var(--surface-3)]/30">
        <div className="flex items-center gap-2 mt-3">
          <Mail size={14} className="text-[var(--text-tertiary)]" />
          <h3 className="text-xs uppercase tracking-[0.12em] text-[var(--text-tertiary)] font-medium">
            Individual emails
          </h3>
        </div>

        {emailRows.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)] italic">
            No individual emails added. Use this for bookkeepers, consultants, or anyone whose
            email domain doesn&apos;t match a domain above.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {emailRows.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[var(--surface-2)]/60 border border-[var(--surface-3)]/40"
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {e.email}
                    </span>
                    {e.role === "local_super_admin" && (
                      <>
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-md border font-medium text-[var(--accent-fg)] border-[var(--ps-yellow)]/40 bg-[var(--ps-yellow)]/10 shrink-0">
                          Local super-admin
                        </span>
                        {/* Global super-admins get live scope checkboxes
                            (re-scope in place); everyone else sees the
                            read-only chips. */}
                        {canManageGrants ? (
                          <EditableScopes
                            id={e.id}
                            clientSlug={clientSlug}
                            scopes={e.scopes}
                          />
                        ) : (
                          scopeBadges(e.scopes).map((label) => (
                            <span
                              key={label}
                              className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-md border font-medium text-[var(--text-secondary)] border-[var(--surface-3)]/60 bg-[var(--surface-2)] shrink-0"
                            >
                              {label}
                            </span>
                          ))
                        )}
                      </>
                    )}
                  </div>
                  {e.note && (
                    <span className="text-[11px] text-[var(--text-tertiary)] truncate">
                      {e.note}
                    </span>
                  )}
                </div>
                {/* Removing a local_super_admin is global-super-admin-only;
                    viewers can be removed by any local admin. */}
                {(e.role !== "local_super_admin" || canManageGrants) && (
                  <form action={removeAllowedEmail} className="shrink-0">
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="clientSlug" value={clientSlug} />
                    <SubmitIcon aria-label={`Remove ${e.email}`}>
                      <Trash2 size={14} />
                    </SubmitIcon>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        <AddAllowedEmailForm
          clientId={clientId}
          clientSlug={clientSlug}
          canManageGrants={canManageGrants}
        />
      </div>
    </section>
  );
}
