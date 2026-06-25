/**
 * Per-client status banner for /[slug]/ads.
 *
 * Renders at the top of the dashboard when the client is in a non-active
 * state (paused or deleted). Tells the viewer what state the client is
 * in and — for super-admins — gives a one-click jump to the admin
 * status panel where they can flip it back.
 *
 * Why this is separate from OnboardingBanner: the onboarding banner is
 * about an incomplete setup; the status banner is about a deliberately
 * inactive client. The /ads page picks which (if any) to render — they
 * never stack.
 */
import { Pause, Trash2, ArrowRight } from "lucide-react";
import { ProgressLink } from "./progress-link";
import type { ClientStatus } from "@/lib/auth";

type Props = {
  status: ClientStatus;
  clientSlug: string;
  /**
   * Renders the "Manage status →" CTA when true. Set this for viewers
   * with write access — global super_admin or local_super_admin on this
   * client.
   */
  canManageThisClient: boolean;
};

export function StatusBanner({ status, clientSlug, canManageThisClient }: Props) {
  if (status === "active") return null;

  const cfg = status === "paused"
    ? {
        Icon: Pause,
        title: "This client is paused",
        body: "ETL pulls are skipped and the client's users can't sign in. Relay staff still have read access from this view.",
        tone: "neutral" as const,
      }
    : {
        Icon: Trash2,
        title: "This client is deleted",
        body: "Soft-deleted — data is preserved. ETL is frozen and the client's users can't sign in. Restore from admin, or permanently delete.",
        tone: "danger" as const,
      };

  const wrapCls =
    cfg.tone === "danger"
      ? "bg-[var(--negative)]/10 border-[var(--negative)]/40"
      : "bg-[var(--surface-2)]/60 border-[var(--surface-3)]/80";

  const iconCls =
    cfg.tone === "danger"
      ? "text-[var(--negative)]"
      : "text-[var(--text-secondary)]";

  const buttonCls =
    cfg.tone === "danger"
      ? "bg-[var(--negative)] text-white hover:bg-[color-mix(in_oklab,var(--negative)_85%,black)]"
      : "bg-[var(--surface-3)] text-[var(--text-primary)] hover:bg-[var(--surface-2)]";

  return (
    <section
      role="status"
      className={
        "border rounded-[var(--radius-card)] px-5 py-4 flex items-start gap-3 flex-wrap " +
        wrapCls
      }
    >
      <cfg.Icon size={18} className={"shrink-0 mt-0.5 " + iconCls} />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)]">
          {cfg.title}
        </div>
        <div className="text-[12px] text-[var(--text-secondary)] mt-1">
          {cfg.body}
        </div>
      </div>

      {canManageThisClient && (
        <ProgressLink
          href={`/${clientSlug}/admin`}
          className={
            "inline-flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-md transition-colors shrink-0 " +
            buttonCls
          }
        >
          Manage status
          <ArrowRight size={14} />
        </ProgressLink>
      )}
    </section>
  );
}
