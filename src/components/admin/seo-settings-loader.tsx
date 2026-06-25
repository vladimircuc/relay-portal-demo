/**
 * Server loader for the SEO settings section — fetches the saved config + a
 * per-source health snapshot (does each source have data yet? when was the last
 * successful pull?) via the admin client, then hands them to the client
 * <SeoSettingsSection>. Kept separate so the /admin page can drop it behind a
 * Suspense boundary without the data fetch blocking the rest of the page.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { listLsgReports } from "@/lib/etl/seo-local-grid";
import { listSeoSources, type SeoSources } from "@/lib/etl/seo-sources";
import type { LsgReportSummary } from "@/lib/etl/brightlocal";
import { SeoSettingsSection } from "./seo-settings-section";
import { SeoLeadsSettings } from "./seo-leads-settings";

export async function SeoSettingsLoader({ clientId, clientSlug, hasSeo, hasAds }: { clientId: string; clientSlug: string; hasSeo: boolean; hasAds: boolean }) {
  const sb = createAdminClient();
  const [cfg, gRows, gaRows, bRows, aiRows, lastRun, lsgReports, lsgLinks, sources] = await Promise.all([
    sb.from("client_seo_config").select("gsc_site_url,ga4_property_id,bing_site_url,show_leads").eq("client_id", clientId).maybeSingle(),
    sb.from("seo_daily_metrics").select("client_id").eq("client_id", clientId).eq("source", "google").limit(1),
    sb.from("seo_ga4_daily").select("client_id").eq("client_id", clientId).limit(1),
    sb.from("seo_daily_metrics").select("client_id").eq("client_id", clientId).eq("source", "bing").limit(1),
    sb.from("seo_ai_daily").select("client_id").eq("client_id", clientId).limit(1),
    sb.from("etl_runs").select("finished_at").eq("client_id", clientId).eq("source", "seo_daily").eq("status", "success").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    // The geo-grid report picker (seo clients only). BrightLocal's UI never
    // exposes report ids, so we list them here by business name. Best-effort:
    // a key/API hiccup yields an empty list (the section shows a note).
    hasSeo ? listLsgReports().catch(() => [] as LsgReportSummary[]) : Promise.resolve([] as LsgReportSummary[]),
    // Which reports are already linked to this client (one → many locations).
    hasSeo ? sb.from("client_lsg_reports").select("report_id").eq("client_id", clientId) : Promise.resolve({ data: [] }),
    // Pick-from-a-list options for the 3 connection fields (best-effort).
    listSeoSources().catch(() => ({ ga4: [], gsc: [], bing: [] }) as SeoSources),
  ]);

  const config = cfg.data ?? { gsc_site_url: null, ga4_property_id: null, bing_site_url: null, show_leads: false };
  const selectedReportIds = ((lsgLinks as { data?: { report_id: number }[] }).data ?? []).map((r) => r.report_id);
  const finishedAt = (lastRun.data as { finished_at?: string } | null)?.finished_at;
  const health = {
    google: (gRows.data?.length ?? 0) > 0,
    ga4: (gaRows.data?.length ?? 0) > 0,
    bing: (bRows.data?.length ?? 0) > 0,
    ai: (aiRows.data?.length ?? 0) > 0,
    lastPulled: finishedAt
      ? new Date(finishedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : null,
  };

  return (
    <>
      <SeoSettingsSection clientId={clientId} clientSlug={clientSlug} config={config} health={health} hasSeo={hasSeo} hasAds={hasAds} reports={lsgReports} selectedReportIds={selectedReportIds} sources={sources} />
      {/* SEO-only clients connect their own CRM here to count website leads;
          ads clients reuse their existing connection (no card needed). */}
      {!hasAds && <SeoLeadsSettings clientId={clientId} clientSlug={clientSlug} />}
    </>
  );
}
