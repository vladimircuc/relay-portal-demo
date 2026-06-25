/**
 * List the GA4 properties / Search Console sites / Bing sites the agency service
 * account (+ Bing API key) can actually see. Powers the admin "pick from a
 * dropdown" selectors so a property/site is chosen from a verified list instead
 * of typed by hand — which is exactly how a wrong GA4 property got configured
 * (two same-named properties, one dormant). Each source is best-effort: if its
 * API errors (or the Admin API isn't enabled), it returns [] and the UI falls
 * back to a manual text field.
 *
 * Server-only (reuses the ETL's domain-wide-delegation JWT). Never import this
 * as a VALUE from a client component — import the types with `import type`.
 */
import { googleAuth } from "./seo";

export type Ga4PropertyOption = { id: string; name: string; account: string };
export type GscSiteOption = { siteUrl: string; permissionLevel: string };
export type BingSiteOption = { url: string };
export type SeoSources = { ga4: Ga4PropertyOption[]; gsc: GscSiteOption[]; bing: BingSiteOption[] };

/** Every GA4 property visible to the impersonated Workspace user (GA4 Admin API,
 *  accountSummaries). Requires the Analytics Admin API to be enabled on the GCP
 *  project. */
export async function listGa4Properties(): Promise<Ga4PropertyOption[]> {
  const auth = googleAuth();
  const { data } = await auth.request<{
    accountSummaries?: { displayName?: string; propertySummaries?: { property: string; displayName: string }[] }[];
  }>({ url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", method: "GET" });
  const out: Ga4PropertyOption[] = [];
  for (const a of data.accountSummaries ?? [])
    for (const p of a.propertySummaries ?? [])
      out.push({ id: p.property.replace("properties/", ""), name: p.displayName, account: a.displayName ?? "" });
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.account.localeCompare(b.account));
}

/** Every verified Search Console site the service account can read (sites.list).
 *  Unverified entries are dropped — they can't be queried anyway. */
export async function listGscSites(): Promise<GscSiteOption[]> {
  const auth = googleAuth();
  const { data } = await auth.request<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>({
    url: "https://searchconsole.googleapis.com/webmasters/v3/sites",
    method: "GET",
  });
  return (data.siteEntry ?? [])
    .filter((s) => s.permissionLevel && s.permissionLevel !== "siteUnverifiedUser")
    .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

/** Every site verified under the single agency Bing Webmaster API key. */
export async function listBingSites(): Promise<BingSiteOption[]> {
  const key = process.env.BING_WEBMASTER_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${key}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Bing GetUserSites ${res.status}`);
  const json = (await res.json()) as { d?: { Url?: string }[] };
  return (json.d ?? [])
    .map((s) => ({ url: s.Url ?? "" }))
    .filter((s) => s.url)
    .sort((a, b) => a.url.localeCompare(b.url));
}

/** All three lists in parallel, each isolated so one failure doesn't sink the
 *  others (the form just shows a manual field for the failed source). */
export async function listSeoSources(): Promise<SeoSources> {
  const [ga4, gsc, bing] = await Promise.all([
    listGa4Properties().catch(() => [] as Ga4PropertyOption[]),
    listGscSites().catch(() => [] as GscSiteOption[]),
    listBingSites().catch(() => [] as BingSiteOption[]),
  ]);
  return { ga4, gsc, bing };
}
