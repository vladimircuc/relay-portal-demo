/**
 * Gather the Socials page's live numbers. Reuses fetchSocialsAnalytics +
 * fetchTopContent with the same comparison-period math the /socials page uses.
 */
import { format, subDays, differenceInCalendarDays } from "date-fns";
import {
  fetchSocialsAnalytics,
  fetchTopContent,
  type PlatformBreakdownRow,
} from "@/lib/socials-timeseries";
import type { SocialPlatform } from "@/lib/etl/social";
import type { ResolvedClient } from "@/lib/auth";
import type { SocialsData, SocialPlatformKey } from "./templates";

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  meta_facebook: "Facebook",
  meta_instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};
const MEDIA_LABEL: Record<string, string> = {
  image: "Photo",
  video: "Video",
  reel: "Reel",
  carousel: "Carousel",
  text: "Text",
};

function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function breakdownMap(rows: PlatformBreakdownRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.platform, r.total);
  return m;
}
/** fetchSocialsAnalytics returns changePct as a PERCENT (e.g. -19.2); the
 *  report's deltaPill expects a FRACTION (-0.192), so normalize here. */
const frac = (p: number | null): number | null => (p == null ? null : p / 100);
function compactNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toLocaleString("en-US");
}

export async function gatherSocialsData(
  client: ResolvedClient,
  startStr: string,
  endStr: string,
): Promise<SocialsData> {
  const start = parseLocal(startStr);
  const end = parseLocal(endStr);
  const lenDays = differenceInCalendarDays(end, start) + 1;
  const compEnd = subDays(start, 1);
  const compStart = subDays(compEnd, lenDays - 1);

  const [analytics, topContent] = await Promise.all([
    fetchSocialsAnalytics({
      clientId: client.id,
      start: startStr,
      end: endStr,
      compStart: format(compStart, "yyyy-MM-dd"),
      compEnd: format(compEnd, "yyyy-MM-dd"),
    }),
    fetchTopContent({ clientId: client.id, start: startStr, end: endStr, timezone: client.timezone }),
  ]);

  const m = analytics.metrics;
  // pivot: one row per platform present in the followers breakdown
  const impr = breakdownMap(m.impressions.breakdown);
  const eng = breakdownMap(m.engagements.breakdown);
  const pv = breakdownMap(m.profile_visits.breakdown);
  const lc = breakdownMap(m.link_clicks.breakdown);

  const platforms = m.follows_gained.breakdown
    .map((row) => ({
      platform: row.platform as SocialPlatformKey,
      label: PLATFORM_LABEL[row.platform] ?? row.platform,
      followers: row.total,
      reachViews: impr.has(row.platform) ? impr.get(row.platform)! : null,
      engagements: eng.has(row.platform) ? eng.get(row.platform)! : null,
      profileVisits: pv.has(row.platform) ? pv.get(row.platform)! : null,
      linkClicks: lc.has(row.platform) ? lc.get(row.platform)! : null,
    }))
    .sort((a, b) => b.followers - a.followers);

  const tag = (i: (typeof topContent)[number]) =>
    `${PLATFORM_LABEL[i.platform] ?? i.platform} · ${MEDIA_LABEL[i.mediaType] ?? i.mediaType}`;

  const byEng = [...topContent]
    .sort((a, b) => b.engagements - a.engagements)
    .slice(0, 3)
    .map((i) => ({ tag: tag(i), caption: i.caption || "—", metric: Math.round(i.engagements).toLocaleString("en-US") }));
  const byViews = [...topContent]
    .sort((a, b) => b.reach.value - a.reach.value)
    .slice(0, 3)
    .map((i) => ({ tag: tag(i), caption: i.caption || "—", metric: compactNum(i.reach.value) }));

  return {
    followers: m.follows_gained.total ?? 0,
    followersDelta: frac(m.follows_gained.changePct),
    impressions: m.impressions.total ?? 0,
    impressionsDelta: frac(m.impressions.changePct),
    engagements: m.engagements.total ?? 0,
    engagementsDelta: frac(m.engagements.changePct),
    profileVisits: m.profile_visits.total ?? 0,
    profileVisitsDelta: frac(m.profile_visits.changePct),
    linkClicks: m.link_clicks.total ?? 0,
    linkClicksDelta: frac(m.link_clicks.changePct),
    platforms,
    topByEngagements: byEng,
    topByViews: byViews,
  };
}
