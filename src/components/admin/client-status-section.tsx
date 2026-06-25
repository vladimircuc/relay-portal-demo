/**
 * Client status / lifecycle section — bottom-of-page admin card.
 *
 * Each available action is its own row: title + body on the left, the
 * action button right-aligned. Rows are separated by a thin divider.
 * This pattern (a) fills the card width properly, (b) gives every
 * action its own explainer (no big upfront paragraph trying to cover
 * every state), and (c) scales naturally when more lifecycle actions
 * appear (e.g. "Transfer ownership", "Mark as demo").
 *
 * Per-status row sets:
 *
 *   Active   → [Pause] [Delete]
 *   Paused   → [Resume] [Delete]
 *   Deleted  → [Restore]  + a separate red-tinted "Permanently delete"
 *              sub-card with the type-the-slug confirm form
 *
 * Permanent delete only renders from the 'deleted' state — that keeps
 * the destructive nuke two clicks away from a healthy client: soft-
 * delete first, THEN you can hard-delete.
 */
import { Pause, Trash2, Play } from "lucide-react";
import {
  pauseClient,
  softDeleteClient,
  restoreClient,
} from "./client-status-actions";
import { PermanentDeleteForm } from "./permanent-delete-form";
import { SubmitPrimary } from "./submit-button";
import { DestructiveSubmit } from "./destructive-submit";
import type { ClientStatus } from "@/lib/auth";

type Props = {
  clientId: string;
  clientName: string;
  clientSlug: string;
  status: ClientStatus;
  /** True only for global super-admins. When false the lifecycle buttons
   *  render disabled — pause/delete/restore are agency-level decisions, so
   *  a scoped local super-admin can see the section but not act on it. */
  canManage: boolean;
};

export function ClientStatusSection({
  clientId,
  clientName,
  clientSlug,
  status,
  canManage,
}: Props) {
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] overflow-hidden">
      <div className="px-7 py-5 border-b border-[var(--surface-3)]/40 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Client status
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="p-7 flex flex-col">
        {!canManage && (
          <p className="text-[12px] text-[var(--text-tertiary)] -mt-1 mb-5">
            Read-only — only Relay super-admins can pause, delete, or restore a client.
          </p>
        )}
        {status === "active" && (
          <>
            <Row
              title="Pause client"
              body="Freezes daily ETL pulls and blocks the client's own users from signing in. Relay staff can still open the dashboard from the Paused section on /clients."
              action={
                <ActionForm
                  action={pauseClient}
                  clientId={clientId}
                  clientSlug={clientSlug}
                  label="Pause client"
                  pendingLabel="Pausing…"
                  icon={<Pause size={14} />}
                  variant="primary"
                  disabled={!canManage}
                />
              }
            />
            <Divider />
            <Row
              title="Delete client"
              body="Soft-delete — moves this client to the Deleted section on /clients. ETL stops, client users lose access, all data is preserved. Restorable from this same panel."
              action={
                <ActionForm
                  action={softDeleteClient}
                  clientId={clientId}
                  clientSlug={clientSlug}
                  label="Delete client"
                  pendingLabel="Deleting…"
                  icon={<Trash2 size={14} />}
                  variant="destructive"
                  disabled={!canManage}
                />
              }
            />
          </>
        )}

        {status === "paused" && (
          <>
            <Row
              title="Resume client"
              body="Puts the dashboard back to Active. ETL pulls resume on the next daily cron, client users can sign in again."
              action={
                <ActionForm
                  action={restoreClient}
                  clientId={clientId}
                  clientSlug={clientSlug}
                  label="Resume client"
                  pendingLabel="Resuming…"
                  icon={<Play size={14} />}
                  variant="primary"
                  disabled={!canManage}
                />
              }
            />
            <Divider />
            <Row
              title="Delete client"
              body="Soft-delete — moves this client to the Deleted section on /clients. ETL stays off, all data is preserved. Restorable from this same panel."
              action={
                <ActionForm
                  action={softDeleteClient}
                  clientId={clientId}
                  clientSlug={clientSlug}
                  label="Delete client"
                  pendingLabel="Deleting…"
                  icon={<Trash2 size={14} />}
                  variant="destructive"
                  disabled={!canManage}
                />
              }
            />
          </>
        )}

        {status === "deleted" && (
          <Row
            title="Restore client"
            body="Moves the client back to Active. ETL pulls resume on the next daily cron, client users regain access, and the client returns to the main /clients grid."
            action={
              <ActionForm
                action={restoreClient}
                clientId={clientId}
                clientSlug={clientSlug}
                label="Restore client"
                pendingLabel="Restoring…"
                icon={<Play size={14} />}
                variant="primary"
              />
            }
          />
        )}
      </div>

      {/* Permanent delete — ONLY visible from the 'deleted' state. Lives
          in its own red-bordered footer block so it's visually walled
          off from the reversible actions above. */}
      {status === "deleted" && (
        <div className="border-t border-[var(--surface-3)]/40 bg-[var(--negative)]/5 p-7">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--negative)]">
                Permanently delete
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1.5 max-w-prose">
                Hard-delete this client and every row that references it:
                credentials, opportunities, daily metrics, ETL run history,
                lifecycle phases, access lists. Vault secrets are wiped and
                uploaded logos are removed from storage. <strong>No undo.</strong>
              </p>
            </div>
            {canManage ? (
              <PermanentDeleteForm
                clientId={clientId}
                clientName={clientName}
                clientSlug={clientSlug}
              />
            ) : (
              <p className="text-[12px] text-[var(--text-tertiary)]">
                Only Relay super-admins can permanently delete a client.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row + divider primitives

function Row({
  title,
  body,
  action,
}: {
  title: string;
  body: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 flex-wrap py-2">
      <div className="flex-1 min-w-0 max-w-prose">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed">
          {body}
        </p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function Divider() {
  return <hr className="my-5 border-[var(--surface-3)]/40" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge

function StatusBadge({ status }: { status: ClientStatus }) {
  const cfg: Record<ClientStatus, { label: string; cls: string }> = {
    active: {
      label: "Active",
      cls: "text-[var(--positive)] border-[var(--positive)]/40 bg-[var(--positive)]/10",
    },
    paused: {
      label: "Paused",
      cls: "text-[var(--text-secondary)] border-[var(--surface-3)]/80 bg-[var(--surface-2)]",
    },
    deleted: {
      label: "Deleted",
      cls: "text-[var(--negative)] border-[var(--negative)]/40 bg-[var(--negative)]/10",
    },
  };
  const c = cfg[status];
  return (
    <span
      className={
        "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border font-medium " +
        c.cls
      }
    >
      {c.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-action form. Each soft transition is its own <form> because we
// need separate server-action handlers — putting them all in one form
// would require dispatching by submitter button identity.

function ActionForm({
  action,
  clientId,
  clientSlug,
  label,
  pendingLabel,
  icon,
  variant,
  disabled,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  clientSlug: string;
  label: string;
  pendingLabel: string;
  icon: React.ReactNode;
  variant: "primary" | "destructive";
  disabled?: boolean;
}) {
  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="clientSlug" value={clientSlug} />
      {variant === "primary" ? (
        <SubmitPrimary pendingLabel={pendingLabel} disabled={disabled}>
          {icon}
          {label}
        </SubmitPrimary>
      ) : (
        <DestructiveSubmit pendingLabel={pendingLabel} disabled={disabled}>
          {icon}
          {label}
        </DestructiveSubmit>
      )}
    </form>
  );
}
