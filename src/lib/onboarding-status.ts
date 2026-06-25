/**
 * Shared onboarding-status checker.
 *
 * Single source of truth for "is this client fully set up?" — used by
 * both the /admin SetupChecklist and the /ads OnboardingBanner so the
 * two surfaces never disagree about what counts as "done."
 *
 * Five parallel single-row reads against indexed (client_id, …) keys.
 * Total round-trip is dominated by network, not query work; safe to
 * call on every page render without caching.
 */
import { createAdminClient } from "./supabase/server";

export type OnboardingStatus = {
  /** Meta + Asera access tokens are both stored in Vault. */
  credentials: boolean;
  /** Asera pipeline picked AND at least one stage-to-phase mapping. */
  pipeline: boolean;
  /** At least one domain or individual email in the allowlist. */
  access: boolean;
  /** At least one successful ETL run on record. */
  firstEtlRun: boolean;
};

export async function getOnboardingStatus(clientId: string): Promise<OnboardingStatus> {
  const supabase = createAdminClient();

  const [
    { data: creds },
    { count: phaseCount },
    { count: domainCount },
    { count: emailCount },
    { count: successfulRunCount },
  ] = await Promise.all([
    supabase
      .from("client_credentials")
      .select("meta_access_token_secret_id, ghl_token_secret_id, ghl_pipeline_id")
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("client_lifecycle_phases")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId),
    supabase
      .from("client_domains")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId),
    supabase
      .from("client_allowed_emails")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId),
    supabase
      .from("etl_runs")
      .select("*", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "success"),
  ]);

  return {
    credentials:
      !!creds?.meta_access_token_secret_id && !!creds?.ghl_token_secret_id,
    pipeline: !!creds?.ghl_pipeline_id && (phaseCount ?? 0) > 0,
    access: (domainCount ?? 0) + (emailCount ?? 0) > 0,
    firstEtlRun: (successfulRunCount ?? 0) > 0,
  };
}

/** Count of incomplete onboarding steps (0–4). 0 means fully onboarded. */
export function stepsRemaining(s: OnboardingStatus): number {
  return (
    (s.credentials ? 0 : 1) +
    (s.pipeline ? 0 : 1) +
    (s.access ? 0 : 1) +
    (s.firstEtlRun ? 0 : 1)
  );
}

export function isFullyOnboarded(s: OnboardingStatus): boolean {
  return stepsRemaining(s) === 0;
}
