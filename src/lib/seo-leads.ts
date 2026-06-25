/**
 * Website-sourced LEADS for the Web & SEO tab's "Show leads" mode.
 *
 * Leads-only — NO revenue (revenue was dropped; the top section keeps Avg
 * Position permanently and only swaps CTR → Website leads).
 *
 * Reads the ISOLATED `seo_lead_opportunities` table (populated by runLeadsPull
 * in the SEO ETL), so it never touches the Ads dashboard's data. Enabled purely
 * by `client_seo_config.show_leads` — works for ads clients (reusing their CRM
 * connection) AND SEO-only clients (their own connection). Returns null when the
 * toggle is off, so the tab renders its normal CTR + Avg Position tiles.
 *
 * The universal website rule is re-applied at read (defense + lets the rule
 * tighten without a re-pull). Leads are bucketed by created-day in the client's
 * timezone, exactly like the Ads attribution.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { isWebsiteLead } from "@/lib/meta-source";

export type LeadsWindow = {
  start: string;
  end: string;
  compStart: string;
  compEnd: string;
  hasFullComparison: boolean;
};

export type WebsiteLeadsResult = {
  totals: { leads: number };
  deltas: { leads: number | null };
  /** day (yyyy-MM-dd, client TZ) → that day's website-lead count. */
  byDay: Map<string, number>;
};

export async function loadWebsiteLeads(
  client: { id: string; timezone: string },
  win: LeadsWindow,
): Promise<WebsiteLeadsResult | null> {
  const sb = createAdminClient();

  // Gate on the toggle only — no ads requirement anymore.
  const { data: cfg } = await sb
    .from("client_seo_config")
    .select("show_leads")
    .eq("client_id", client.id)
    .maybeSingle();
  if (!(cfg as { show_leads?: boolean } | null)?.show_leads) return null;

  // Generous UTC bounds (±2 days) — bucket precisely to client-TZ days below.
  const fromUtc = new Date(new Date(`${win.compStart}T00:00:00Z`).getTime() - 2 * 86_400_000).toISOString();
  const toUtc = new Date(new Date(`${win.end}T00:00:00Z`).getTime() + 2 * 86_400_000).toISOString();
  const { data: opps } = await sb
    .from("seo_lead_opportunities")
    .select("source, tags, created_at_ghl")
    .eq("client_id", client.id)
    .gte("created_at_ghl", fromUtc)
    .lte("created_at_ghl", toUtc);

  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: client.timezone || "UTC" });
  const byDay = new Map<string, number>();

  for (const o of (opps ?? []) as {
    source: string | null; tags: string[] | null; created_at_ghl: string;
  }[]) {
    if (!o.created_at_ghl) continue;
    if (!isWebsiteLead(o.source, o.tags)) continue; // re-apply the rule (defense)
    const day = fmt.format(new Date(o.created_at_ghl));
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const sumWindow = (s: string, e: string) => {
    let leads = 0;
    for (const [d, v] of byDay) if (d >= s && d <= e) leads += v;
    return leads;
  };
  const period = sumWindow(win.start, win.end);
  const prev = sumWindow(win.compStart, win.compEnd);
  // Percent change, matching seo-data's pctChange convention (null when no prior).
  const pct = (c: number, p: number): number | null => (p > 0 ? +(((c - p) / p) * 100).toFixed(1) : null);

  return {
    totals: { leads: period },
    deltas: win.hasFullComparison ? { leads: pct(period, prev) } : { leads: null },
    byDay,
  };
}
