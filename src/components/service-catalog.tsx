/**
 * Single source of truth for per-service marketing copy + teaser mock data.
 * Used by:
 *   - <LockedTab>      — the blurred-preview + modal shown when a client opens a
 *                        tab for a service they don't have.
 *   - <HomeOverview>   — the "what you can see" cards (owned) AND the
 *                        "grow with Relay" cards (not owned).
 *
 * Keyed by Capability so it stays in lockstep with enabled_services. Teaser
 * numbers are illustrative only (they sit behind a blur), tuned to read as a
 * healthy, growing account.
 */
import { LineChart, Share2, Search, type LucideIcon } from "lucide-react";
import type { Capability } from "@/lib/auth";

export type ServiceTile = { label: string; value: string; delta: string };
export type ServiceMeta = {
  /** Full service name for the locked modal / unowned card (e.g. "Meta Ads"). */
  label: string;
  /** Short nav-style label (matches the tab): "Ads" / "Socials" / "Web & SEO". */
  navLabel: string;
  icon: LucideIcon;
  /** One-liner for owned home cards. */
  blurb: string;
  /** "What it is + why it matters" — the locked modal / unowned-card pitch. */
  pitch: string;
  /** 2–3 plain-language benefits (the "why you'd want it" sell). */
  benefits: string[];
  /** "What you'll see" feature bullets — for the OWNED home cards. */
  features: string[];
  /** Curated mock tiles for the blurred teaser preview. */
  teaserTiles: ServiceTile[];
  /** Mock chart series (normalised when drawn) + its label. */
  teaserSeries: number[];
  teaserChartLabel: string;
};

export const SERVICE_CATALOG: Record<Capability, ServiceMeta> = {
  ads: {
    label: "Meta Ads",
    navLabel: "Ads",
    icon: LineChart,
    blurb: "Your paid-advertising performance — what you're spending and what it brings back.",
    pitch:
      "Run Facebook & Instagram lead-gen campaigns with every dollar tied to real outcomes — leads, booked calls, and revenue — not just clicks.",
    benefits: [
      "A predictable flow of new leads from paid social",
      "The full funnel: spend → lead → booking → show → revenue",
      "Clear cost-per-lead and return on ad spend, updated daily",
    ],
    features: [
      "Spend, leads, and cost per result for any date range",
      "The full lead → booking → show → conversion funnel",
      "Lead-source breakdown with period-over-period change",
    ],
    teaserTiles: [
      { label: "Ad spend", value: "$4,820", delta: "12%" },
      { label: "Leads", value: "128", delta: "18%" },
      { label: "Bookings", value: "41", delta: "15%" },
      { label: "Revenue", value: "$22.4K", delta: "27%" },
    ],
    teaserSeries: [42, 38, 45, 51, 48, 55, 60, 58, 66, 72, 69, 78, 84, 80, 91, 98],
    teaserChartLabel: "Leads over time",
  },
  socials: {
    label: "Social Media",
    navLabel: "Socials",
    icon: Share2,
    blurb: "Your organic social performance across every connected platform.",
    pitch:
      "Grow and measure your organic presence across Facebook, Instagram, TikTok, YouTube & LinkedIn — all in one place instead of five separate apps.",
    benefits: [
      "Grow your audience and engagement month over month",
      "See exactly which posts and platforms perform best",
      "One cross-platform view of reach, impressions, and engagement",
    ],
    features: [
      "Followers, reach, impressions, and engagement over time",
      "Facebook, Instagram, YouTube, TikTok & LinkedIn side by side",
      "Your top-performing posts and content mix",
    ],
    teaserTiles: [
      { label: "Followers", value: "12.4K", delta: "6%" },
      { label: "Impressions", value: "318K", delta: "22%" },
      { label: "Engagements", value: "9,240", delta: "14%" },
      { label: "Profile visits", value: "2,110", delta: "8%" },
    ],
    teaserSeries: [120, 135, 128, 150, 162, 158, 175, 190, 185, 205, 220, 212, 238, 255, 248, 272],
    teaserChartLabel: "Engagements over time",
  },
  web: {
    label: "Web & SEO",
    navLabel: "Web & SEO",
    icon: Search,
    blurb: "Your website + search visibility — traffic, how people find you, and where you rank.",
    pitch:
      "Track your website and search performance — Google rankings, traffic, and a local map heatmap that shows exactly where you rank across your service area, block by block.",
    benefits: [
      "Rank higher on Google and the local map",
      "Clicks, impressions, traffic, and conversions in one place",
      "A geo-grid heatmap of your local ranking across your area",
    ],
    features: [
      "Website analytics — sessions, users, conversions, and traffic sources",
      "Clicks, impressions, CTR, and average ranking position over time",
      "The keywords and pages you rank for, plus AI Performance",
    ],
    teaserTiles: [
      { label: "Clicks", value: "1,240", delta: "16%" },
      { label: "Impressions", value: "48.2K", delta: "21%" },
      { label: "Avg position", value: "8.3", delta: "11%" },
      { label: "Sessions", value: "3,410", delta: "9%" },
    ],
    teaserSeries: [60, 72, 68, 80, 88, 95, 90, 104, 112, 108, 120, 132, 128, 140, 150, 162],
    teaserChartLabel: "Search clicks over time",
  },
};
