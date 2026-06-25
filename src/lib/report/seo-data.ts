/**
 * Gather the Web & SEO page data + one LocalMapData per tracked keyword.
 * Reuses loadSeoData with the same comparison-period math the /seo page uses.
 */
import { format, subDays, differenceInCalendarDays } from "date-fns";
import { loadSeoData } from "@/lib/seo-data";
import type { ResolvedClient } from "@/lib/auth";
import type { SeoData, LocalMapData } from "./templates";

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
/** GA4 engagement rate may be stored as a fraction (0..1) or a percent. */
function asFraction(v: number): number {
  return v > 1 ? v / 100 : v;
}
/** loadSeoData deltas are PERCENTS (e.g. -39.0); the report's deltaPill expects
 *  a FRACTION (-0.39), so normalize here. */
const frac = (p: number | null): number | null => (p == null ? null : p / 100);

export type SeoGathered = { page: SeoData; localKeywords: LocalMapData[] };

export async function gatherSeoData(
  client: ResolvedClient,
  startStr: string,
  endStr: string,
  includeLocal: boolean,
): Promise<SeoGathered> {
  const start = parseLocal(startStr);
  const end = parseLocal(endStr);
  const lenDays = differenceInCalendarDays(end, start) + 1;
  const compEnd = subDays(start, 1);
  const compStart = subDays(compEnd, lenDays - 1);

  const seo = await loadSeoData(client.id, {
    start: startStr,
    end: endStr,
    compStart: format(compStart, "yyyy-MM-dd"),
    compEnd: format(compEnd, "yyyy-MM-dd"),
  });

  const g = seo.google;
  const ctr = g.totals.impressions ? g.totals.clicks / g.totals.impressions : 0;

  const page: SeoData = {
    search: {
      clicks: g.totals.clicks,
      clicksDelta: frac(g.deltas.clicks),
      impressions: g.totals.impressions,
      impressionsDelta: frac(g.deltas.impressions),
      aiCitations: seo.ai.totalCitations,
      aiCitationsDelta: frac(seo.ai.deltas.citations),
      ctr,
      ctrDelta: frac(g.deltas.ctr),
      position: g.totals.position,
      positionDelta: frac(g.deltas.position),
    },
    web: {
      sessions: seo.ga4.totals.sessions,
      sessionsDelta: frac(seo.ga4.deltas.sessions),
      users: seo.ga4.totals.users,
      usersDelta: frac(seo.ga4.deltas.users),
      conversions: seo.ga4.totals.conversions,
      conversionsDelta: frac(seo.ga4.deltas.conversions),
      engagementRate: asFraction(seo.ga4.totals.engagementRate),
      engagementRateDelta: frac(seo.ga4.deltas.engagementRate),
    },
    topQueries: g.topQueries.slice(0, 5).map((q) => ({ query: q.query, clicks: q.clicks, position: q.position })),
    topPages: g.topPages.slice(0, 5).map((p) => ({ page: p.page, clicks: p.clicks })),
    channels: seo.ga4.channels.map((c) => ({ name: c.name, sessions: c.sessions })),
  };

  const monthLabel = format(end, "MMM yyyy");
  const localKeywords: LocalMapData[] = [];
  if (includeLocal) {
    for (const grid of seo.localGrids) {
      const locationName = grid.business?.name ?? null;
      // Cap at the top 2 keywords per BrightLocal report (location) so a client
      // with several locations doesn't blow the report up to a dozen pages.
      const usable = grid.keywords.filter((k) => k.points.length > 0).slice(0, 2);
      for (const k of usable) {
        const center =
          grid.center ??
          (grid.business ? { lat: grid.business.lat, lng: grid.business.lng } : centroid(k.points));
        // mark the grid point nearest the business/center as the business pin
        const anchor = grid.business ?? center;
        let bizIdx = -1;
        let bizDist = Infinity;
        k.points.forEach((p, i) => {
          const dd = (p.lat - anchor.lat) ** 2 + (p.lng - anchor.lng) ** 2;
          if (dd < bizDist) {
            bizDist = dd;
            bizIdx = i;
          }
        });
        const top3 = k.bands.high ?? 0;
        const mid = k.bands.med ?? 0;
        const low = k.bands.low ?? 0;
        const total = k.numPoints || k.points.length;
        localKeywords.push({
          keyword: k.keyword,
          locationName,
          monthLabel,
          avgRank: k.avgRank,
          totalPoints: total,
          bands: { top3, mid, low, none: Math.max(0, total - top3 - mid - low) },
          center,
          points: k.points.map((p, i) => ({ lat: p.lat, lng: p.lng, rank: p.rank, isBiz: i === bizIdx })),
          competitors: k.competitors.slice(0, 5).map((c) => ({
            rank: c.rank,
            name: c.title,
            reviews: c.reviews,
            rating: c.rating,
            isClient: c.isClient,
          })),
        });
      }
    }
  }

  return { page, localKeywords };
}

function centroid(points: Array<{ lat: number; lng: number }>): { lat: number; lng: number } {
  const n = points.length || 1;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  };
}
