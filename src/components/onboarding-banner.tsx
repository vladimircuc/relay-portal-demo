/**
 * Onboarding-in-progress banner for the /[slug]/ads dashboard.
 *
 * Renders at the top of the dashboard whenever the client isn't fully
 * set up yet (any of credentials / pipeline / access / first ETL run
 * still pending). Gives context for why the cards below might be empty
 * or showing zeros, and — for super-admins — a direct jumplink to the
 * /admin checklist where they can finish.
 *
 * Three audiences, three slightly different framings:
 *   - super-admin → "you" have setup to finish, with a CTA to /admin
 *   - admin (no /admin access) → "setup is still being completed"
 *     informational only
 *   - client user → same informational copy; they shouldn't see this
 *     often since access is itself one of the setup steps, but if they
 *     somehow get a session before ETL has run, this explains the empty
 *     dashboard rather than making it look broken.
 *
 * The whole banner disappears once status flips to fully-onboarded so
 * it doesn't clutter routine viewing.
 */
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  getOnboardingStatus,
  isFullyOnboarded,
  stepsRemaining,
} from "@/lib/onboarding-status";
import { ProgressLink } from "./progress-link";

type Props = {
  clientId: string;
  clientSlug: string;
  /**
   * Renders the "Finish setup →" CTA when true. Set for viewers with
   * write access — global super_admin or local_super_admin on this
   * client.
   */
  canManageThisClient: boolean;
};

export async function OnboardingBanner({
  clientId,
  clientSlug,
  canManageThisClient,
}: Props) {
  const status = await getOnboardingStatus(clientId);
  if (isFullyOnboarded(status)) return null;

  const remaining = stepsRemaining(status);
  const noEtlYet = !status.firstEtlRun;

  return (
    <section
      role="status"
      className="bg-[var(--ps-yellow)]/10 border border-[var(--ps-yellow)]/40 rounded-[var(--radius-card)] px-5 py-4 flex items-start gap-3 flex-wrap"
    >
      <AlertTriangle size={18} className="text-[var(--accent-fg)] shrink-0 mt-0.5" />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--text-primary)]">
          Setup is still in progress
          <span className="text-[var(--text-tertiary)] tabular-nums ml-2 font-normal">
            ({remaining} step{remaining === 1 ? "" : "s"} remaining)
          </span>
        </div>
        <div className="text-[12px] text-[var(--text-secondary)] mt-1">
          {noEtlYet
            ? "Numbers below will populate once the first ETL pull completes."
            : "The dashboard is operational, but a few setup steps are still incomplete."}
        </div>
      </div>

      {canManageThisClient && (
        <ProgressLink
          href={`/${clientSlug}/admin`}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)] transition-colors shrink-0"
        >
          Finish setup
          <ArrowRight size={14} />
        </ProgressLink>
      )}
    </section>
  );
}
