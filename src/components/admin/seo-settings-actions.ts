"use server";

/**
 * Server actions for the per-client SEO settings section (/admin).
 *
 *   updateSeoConfig   — save the 3 property identifiers (GSC site, GA4 property
 *                       id, Bing site) into client_seo_config. The nightly pull
 *                       + the "Run backfill" button read these.
 *   uploadSeoAiCsvs   — ingest the 3 Bing "AI Performance" CSV exports into the
 *                       seo_ai_* tables. UPSERT/merge only — NEVER deletes, so
 *                       re-uploading accumulates history (new days/queries/pages
 *                       added, overlapping ones refreshed) and never loses prior
 *                       data. Touches only this client's 3 AI tables.
 *
 * Both are gated by requireScopeForClient(clientId, "web") — super-admin, or a
 * local admin scoped to SEO on this client. The backfill itself runs via the
 * /api/etl/seo/[clientId] route (long pulls belong in a Node route, not an
 * action), triggered by the button component.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireScopeForClient } from "@/lib/auth";
import { assertWritable } from "@/lib/demo";

/** Bing CSVs are quoted-field rows ("a","b"). Strip header + parse each line. */
function csvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((l) => (l.match(/"([^"]*)"/g) ?? []).map((x) => x.slice(1, -1)));
}
/** "3/9/2026 12:00:00 AM" → "2026-03-09". */
function toIsoDate(s: string): string {
  const [mm, dd, yy] = s.split(" ")[0].split("/");
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

type Sb = ReturnType<typeof createAdminClient>;
/** Wipe all GA4 cache rows for a client (used when its GA4 property changes — the
 *  old rows are from the previous property and must not linger/mix). */
async function clearGa4Cache(sb: Sb, clientId: string): Promise<void> {
  for (const t of ["seo_ga4_daily", "seo_ga4_channel_daily", "seo_ga4_landing_daily", "seo_ga4_channels", "seo_ga4_landing_pages"]) {
    await sb.from(t).delete().eq("client_id", clientId);
  }
}
/** Wipe one search source's cache rows (source = "google" | "bing") when its
 *  site URL changes. Tables without rows for that source simply delete nothing. */
async function clearSearchSourceCache(sb: Sb, clientId: string, source: "google" | "bing"): Promise<void> {
  for (const t of ["seo_daily_metrics", "seo_query_daily", "seo_page_daily", "seo_top_queries", "seo_top_pages"]) {
    await sb.from(t).delete().eq("client_id", clientId).eq("source", source);
  }
}

export async function updateSeoConfig(formData: FormData): Promise<void> {
  assertWritable("Update SEO config");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "web");

  const gsc = String(formData.get("gsc_site_url") ?? "").trim() || null;
  const ga4 = String(formData.get("ga4_property_id") ?? "").trim() || null;
  const bing = String(formData.get("bing_site_url") ?? "").trim() || null;
  // "Show website leads" is available to any Web & SEO client now. Ads clients
  // reuse their CRM connection; SEO-only clients connect their own (the Website
  // leads card below). When on but unconnected, the tab just shows no leads.
  const showLeads = String(formData.get("show_leads") ?? "") === "1";

  const supabase = createAdminClient();

  // What was configured before? A source that CHANGES means its cached rows
  // belong to the old property/site — wipe them so the re-pull (auto-triggered
  // by the UI) repopulates cleanly instead of mixing two sources' data. This is
  // the generalised, automatic version of the manual cleanup SQL.
  const { data: prev } = await supabase
    .from("client_seo_config")
    .select("gsc_site_url,ga4_property_id,bing_site_url")
    .eq("client_id", clientId)
    .maybeSingle();

  const { error } = await supabase.from("client_seo_config").upsert(
    {
      client_id: clientId,
      gsc_site_url: gsc,
      ga4_property_id: ga4,
      bing_site_url: bing,
      show_leads: showLeads,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  if (error) throw new Error(error.message);

  if (prev) {
    if ((prev.ga4_property_id ?? null) !== ga4) await clearGa4Cache(supabase, clientId);
    if ((prev.gsc_site_url ?? null) !== gsc) await clearSearchSourceCache(supabase, clientId, "google");
    if ((prev.bing_site_url ?? null) !== bing) await clearSearchSourceCache(supabase, clientId, "bing");
  }

  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/seo`);
}

/** Link one more BrightLocal Local Search Grid report (location) to the client.
 *  A client can have many — each renders its own grid section on the dashboard. */
export async function addSeoGridReport(formData: FormData): Promise<void> {
  assertWritable("Add SEO grid report");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "web");

  // Accept a bare id or a pasted URL — grab the digits.
  const digits = String(formData.get("report_id") ?? "").trim().match(/\d+/)?.[0] ?? "";
  const reportId = digits ? Number(digits) : null;
  if (!reportId) throw new Error("Pick a report to add");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("client_lsg_reports")
    .upsert({ client_id: clientId, report_id: reportId }, { onConflict: "client_id,report_id" });
  if (error) throw new Error(error.message);

  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/seo`);
}

/** Unlink a report from the client + drop its map rows so it disappears from the
 *  dashboard immediately (competitors/history are keyed by keyword and refreshed
 *  on the next pull, so stale rows for a removed report are simply never shown). */
export async function removeSeoGridReport(formData: FormData): Promise<void> {
  assertWritable("Remove SEO grid report");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "web");

  const reportId = Number(String(formData.get("report_id") ?? "").match(/\d+/)?.[0] ?? "");
  if (!reportId) throw new Error("Missing report id");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("client_lsg_reports")
    .delete()
    .eq("client_id", clientId)
    .eq("report_id", reportId);
  if (error) throw new Error(error.message);
  await supabase.from("seo_local_grid").delete().eq("client_id", clientId).eq("report_id", reportId);

  revalidatePath(`/${clientSlug}/admin`);
  revalidatePath(`/${clientSlug}/seo`);
}

export async function uploadSeoAiCsvs(formData: FormData): Promise<void> {
  assertWritable("Upload SEO AI CSVs");
  const clientId = String(formData.get("clientId") ?? "");
  const clientSlug = String(formData.get("clientSlug") ?? "");
  if (!clientId || !clientSlug) throw new Error("Missing client identifiers");
  await requireScopeForClient(clientId, "web");

  const supabase = createAdminClient();
  const readFile = async (name: string): Promise<string[][] | null> => {
    const f = formData.get(name) as File | null;
    if (!f || typeof f.text !== "function" || f.size === 0) return null;
    return csvRows(await f.text());
  };

  // MERGE only (upsert, no deletes): re-uploading never loses prior data —
  // overlapping rows are refreshed, new rows added.
  const overview = await readFile("overview");
  if (overview) {
    const rows = overview
      .filter((r) => r.length >= 3)
      .map((r) => ({ client_id: clientId, day: toIsoDate(r[0]), citations: Number(r[1]) || 0, cited_pages: Number(r[2]) || 0 }));
    if (rows.length) {
      const { error } = await supabase.from("seo_ai_daily").upsert(rows, { onConflict: "client_id,day" });
      if (error) throw new Error(`AI overview CSV: ${error.message}`);
    }
  }

  const queries = await readFile("queries");
  if (queries) {
    const rows = queries
      .filter((r) => r.length >= 2)
      .map((r) => ({ client_id: clientId, query: r[0], citations: Number(r[1]) || 0 }));
    if (rows.length) {
      const { error } = await supabase.from("seo_ai_grounding_queries").upsert(rows, { onConflict: "client_id,query" });
      if (error) throw new Error(`AI queries CSV: ${error.message}`);
    }
  }

  const pages = await readFile("pages");
  if (pages) {
    const rows = pages
      .filter((r) => r.length >= 2)
      .map((r) => ({ client_id: clientId, page: r[0], citations: Number(r[1]) || 0 }));
    if (rows.length) {
      const { error } = await supabase.from("seo_ai_cited_pages").upsert(rows, { onConflict: "client_id,page" });
      if (error) throw new Error(`AI pages CSV: ${error.message}`);
    }
  }

  revalidatePath(`/${clientSlug}/seo`);
}
