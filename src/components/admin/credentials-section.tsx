/**
 * Per-client Credentials section — Meta + Asera (GHL/LeadConnector) tokens and config.
 *
 * Reads the current `client_credentials` row, renders two side-by-side
 * cards (stacks on mobile). Each card has:
 *   - A token field (password input). Placeholder reflects whether a
 *     secret is currently stored. Leaving it blank on save keeps the
 *     existing vault secret untouched — only non-secret fields update.
 *   - Source-specific config fields.
 *   - A "Save" button and a small "Clear" link.
 *
 * The actual vault writes happen in credentials-actions.ts.
 */
import { createAdminClient } from "@/lib/supabase/server";
import {
  saveMetaCredentials,
  clearMetaCredentials,
  saveGhlCredentials,
  clearGhlCredentials,
} from "./credentials-actions";
import { SubmitPrimary, SubmitLink } from "./submit-button";

type Props = {
  clientId: string;
  clientSlug: string;
};

type CredsRow = {
  meta_access_token_secret_id: string | null;
  meta_ad_account_id: string | null;
  meta_result_type: string;
  ghl_token_secret_id: string | null;
  ghl_location_id: string | null;
  ghl_pipeline_id: string | null;
  updated_at: string;
};

export async function CredentialsSection({ clientId, clientSlug }: Props) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("client_credentials")
    .select(
      "meta_access_token_secret_id, meta_ad_account_id, meta_result_type, ghl_token_secret_id, ghl_location_id, ghl_pipeline_id, updated_at",
    )
    .eq("client_id", clientId)
    .maybeSingle();

  // Default empty state if no row exists yet
  const creds: CredsRow = (data as CredsRow | null) ?? {
    meta_access_token_secret_id: null,
    meta_ad_account_id: null,
    meta_result_type: "lead",
    ghl_token_secret_id: null,
    ghl_location_id: null,
    ghl_pipeline_id: null,
    updated_at: "",
  };

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Credentials</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Meta Ads + Asera access for the daily pulls. Tokens are stored encrypted in Supabase
          Vault; only the secret ID is kept in plain SQL.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* ── Meta Ads ─────────────────────────────────────────────────── */}
        <CredentialCard
          icon={<img src="/brand/meta-icon.png" alt="Meta" className="h-5 w-5 object-contain" aria-hidden />}
          title="Meta Ads"
          tokenSet={!!creds.meta_access_token_secret_id}
        >
          <form action={saveMetaCredentials} className="flex flex-col gap-3">
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="clientSlug" value={clientSlug} />

            <Field label="Access token">
              <input
                name="token"
                type="password"
                autoComplete="off"
                placeholder={
                  creds.meta_access_token_secret_id
                    ? "•••••••••• (leave blank to keep)"
                    : "Paste Meta access token"
                }
                className={inputCls}
              />
            </Field>

            <Field label="Ad account ID">
              <input
                name="adAccountId"
                type="text"
                autoComplete="off"
                defaultValue={creds.meta_ad_account_id ?? ""}
                placeholder="123456789012345 (or act_123…)"
                className={inputCls}
              />
            </Field>

            {/* Result type is hardcoded to "lead" in the save action —
                not exposed in the UI. If we ever need per-client
                overrides (e.g. a client that counts "purchase" instead),
                add the field back in. */}

            <div className="flex items-center justify-between gap-2 pt-1">
              <ClearForm
                action={clearMetaCredentials}
                disabled={
                  !creds.meta_access_token_secret_id &&
                  !creds.meta_ad_account_id &&
                  creds.meta_result_type === "lead"
                }
              />
              <SubmitPrimary pendingLabel="Saving…">Save</SubmitPrimary>
            </div>
          </form>
        </CredentialCard>

        {/* ── Asera (GHL/LeadConnector under the hood) ──────────────────── */}
        <CredentialCard
          icon={<img src="/brand/asera-icon.png" alt="Asera" className="h-5 w-5 object-contain" aria-hidden />}
          title="Asera"
          tokenSet={!!creds.ghl_token_secret_id}
        >
          <form action={saveGhlCredentials} className="flex flex-col gap-3">
            <input type="hidden" name="clientId" value={clientId} />
            <input type="hidden" name="clientSlug" value={clientSlug} />

            <Field label="Access token">
              <input
                name="token"
                type="password"
                autoComplete="off"
                placeholder={
                  creds.ghl_token_secret_id
                    ? "•••••••••• (leave blank to keep)"
                    : "Paste Asera access token"
                }
                className={inputCls}
              />
            </Field>

            <Field
              label="Location ID"
              hint="Pipeline is picked separately below once token + location are saved."
            >
              <input
                name="locationId"
                type="text"
                autoComplete="off"
                defaultValue={creds.ghl_location_id ?? ""}
                placeholder="e.g. abcdef123…"
                className={inputCls}
              />
            </Field>

            <div className="flex items-center justify-between gap-2 pt-1">
              <ClearForm
                action={clearGhlCredentials}
                disabled={
                  !creds.ghl_token_secret_id &&
                  !creds.ghl_location_id &&
                  !creds.ghl_pipeline_id
                }
              />
              <SubmitPrimary pendingLabel="Saving…">Save</SubmitPrimary>
            </div>
          </form>
        </CredentialCard>
      </div>

      {creds.updated_at && (
        <div className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
          Last updated {new Date(creds.updated_at).toLocaleString()}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small UI helpers

const inputCls =
  "bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--ps-yellow)] w-full font-mono";

function CredentialCard({
  icon,
  title,
  tokenSet,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tokenSet: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        </div>
        <span
          className={
            "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border " +
            (tokenSet
              ? "text-[var(--positive)] border-[var(--positive)]/40 bg-[var(--positive)]/10"
              : "text-[var(--text-tertiary)] border-[var(--surface-3)]/60 bg-[var(--surface-3)]/30")
          }
        >
          {tokenSet ? "Token set" : "Not set"}
        </span>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-tertiary)]">{hint}</span>}
    </label>
  );
}

/**
 * "Clear credentials" button that uses React 19's `formAction` prop to
 * override the parent form's action when this specific button is the
 * one that submitted the form.
 *
 * Why not a nested <form>? HTML doesn't allow it, and React 19 surfaces
 * it as a hydration error. The clientId / clientSlug hidden inputs are
 * already in the parent form, so this button just borrows the parent's
 * payload and points it at clearMetaCredentials / clearGhlCredentials
 * instead of the save action.
 */
function ClearForm({
  action,
  disabled,
}: {
  action: (formData: FormData) => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <SubmitLink
      tone="danger"
      pendingLabel="Clearing…"
      disabled={disabled}
      formAction={action}
    >
      Clear
    </SubmitLink>
  );
}
