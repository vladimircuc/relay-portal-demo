// Synthetic data for the Relay demo. No real backend — these numbers are made up
// and live entirely in the client bundle. Trends are hardcoded (not random) so
// server and client render identically.

export type Service = "ads" | "socials" | "web" | "seo";

export type SocialAccount = {
  platform: "instagram" | "facebook" | "tiktok" | "youtube" | "linkedin";
  handle: string;
  followers: number;
  growth: number; // fractional, e.g. 0.042 = +4.2%
  engagement: number; // fractional
  connected: boolean;
};

export type Client = {
  slug: string;
  name: string;
  industry: string;
  accent: string;
  services: Service[];
  spend: number;
  revenue: number;
  roas: number;
  leads: number;
  cpl: number;
  conversions: number;
  d: { spend: number; revenue: number; roas: number; leads: number };
  funnel: { label: string; value: number }[];
  revenueTrend: number[];
  spendTrend: number[];
  social: SocialAccount[];
  seo: { clicks: number; impressions: number; ctr: number; position: number; clicksTrend: number[] } | null;
};

export const DEMO_USER = { email: "demo@relay.app", role: "Super admin" as const };

export const CLIENTS: Client[] = [
  {
    slug: "brightside-dental",
    name: "Brightside Dental",
    industry: "Dental practice",
    accent: "#3aa0ff",
    services: ["ads", "socials", "web", "seo"],
    spend: 9420, revenue: 71300, roas: 7.57, leads: 184, cpl: 51.2, conversions: 63,
    d: { spend: 0.08, revenue: 0.21, roas: 0.12, leads: 0.16 },
    funnel: [
      { label: "Leads", value: 184 },
      { label: "Consults booked", value: 121 },
      { label: "Consults held", value: 92 },
      { label: "New patients", value: 63 },
    ],
    revenueTrend: [38, 41, 44, 43, 49, 52, 55, 58, 61, 64, 67, 71],
    spendTrend: [7.1, 7.4, 7.8, 8.0, 8.1, 8.4, 8.6, 8.9, 9.0, 9.1, 9.3, 9.4],
    social: [
      { platform: "instagram", handle: "@brightsidedental", followers: 18420, growth: 0.042, engagement: 0.061, connected: true },
      { platform: "facebook", handle: "Brightside Dental", followers: 12100, growth: 0.018, engagement: 0.022, connected: true },
      { platform: "tiktok", handle: "@brightsidesmiles", followers: 8730, growth: 0.094, engagement: 0.083, connected: true },
    ],
    seo: { clicks: 4820, impressions: 121400, ctr: 0.0397, position: 6.4, clicksTrend: [3.1, 3.3, 3.5, 3.6, 3.9, 4.0, 4.2, 4.3, 4.5, 4.6, 4.7, 4.82] },
  },
  {
    slug: "apex-law",
    name: "Apex Law Group",
    industry: "Personal injury law",
    accent: "#c9a227",
    services: ["ads", "web", "seo"],
    spend: 22850, revenue: 318000, roas: 13.9, leads: 96, cpl: 238, conversions: 14,
    d: { spend: 0.04, revenue: 0.31, roas: 0.26, leads: -0.05 },
    funnel: [
      { label: "Leads", value: 96 },
      { label: "Qualified", value: 58 },
      { label: "Signed retainers", value: 21 },
      { label: "Cases won", value: 14 },
    ],
    revenueTrend: [180, 195, 210, 205, 230, 248, 262, 270, 285, 298, 309, 318],
    spendTrend: [19, 20, 21, 21.5, 22, 22.1, 22.3, 22.4, 22.6, 22.7, 22.8, 22.85],
    social: [],
    seo: { clicks: 9120, impressions: 284000, ctr: 0.0321, position: 4.1, clicksTrend: [6.4, 6.8, 7.1, 7.3, 7.6, 7.9, 8.2, 8.4, 8.6, 8.8, 9.0, 9.12] },
  },
  {
    slug: "pulse-fitness",
    name: "Pulse Fitness Co",
    industry: "Boutique gym",
    accent: "#ff5d5d",
    services: ["ads", "socials"],
    spend: 6180, revenue: 41200, roas: 6.67, leads: 312, cpl: 19.8, conversions: 148,
    d: { spend: 0.12, revenue: 0.09, roas: -0.03, leads: 0.22 },
    funnel: [
      { label: "Leads", value: 312 },
      { label: "Trials booked", value: 214 },
      { label: "Trials attended", value: 176 },
      { label: "Memberships", value: 148 },
    ],
    revenueTrend: [29, 31, 33, 32, 35, 36, 37, 38, 39, 40, 40.5, 41.2],
    spendTrend: [4.9, 5.1, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9, 6.0, 6.05, 6.1, 6.18],
    social: [
      { platform: "instagram", handle: "@pulsefitco", followers: 41200, growth: 0.071, engagement: 0.094, connected: true },
      { platform: "tiktok", handle: "@pulsefit", followers: 88600, growth: 0.131, engagement: 0.112, connected: true },
      { platform: "youtube", handle: "Pulse Fitness", followers: 14300, growth: 0.038, engagement: 0.041, connected: false },
    ],
    seo: null,
  },
  {
    slug: "wander-coffee",
    name: "Wander Coffee",
    industry: "DTC coffee roaster",
    accent: "#b07a4a",
    services: ["socials", "web"],
    spend: 4100, revenue: 58900, roas: 14.4, leads: 0, cpl: 0, conversions: 1840,
    d: { spend: 0.03, revenue: 0.18, roas: 0.15, leads: 0 },
    funnel: [
      { label: "Sessions", value: 41200 },
      { label: "Add to cart", value: 6240 },
      { label: "Checkout", value: 2380 },
      { label: "Orders", value: 1840 },
    ],
    revenueTrend: [41, 44, 46, 45, 48, 50, 52, 53, 55, 56, 57.5, 58.9],
    spendTrend: [3.6, 3.7, 3.8, 3.85, 3.9, 3.95, 4.0, 4.0, 4.05, 4.05, 4.08, 4.1],
    social: [
      { platform: "instagram", handle: "@wandercoffee", followers: 64800, growth: 0.052, engagement: 0.071, connected: true },
      { platform: "tiktok", handle: "@wandercoffee", followers: 121000, growth: 0.088, engagement: 0.064, connected: true },
    ],
    seo: { clicks: 15200, impressions: 402000, ctr: 0.0378, position: 5.2, clicksTrend: [11, 11.6, 12, 12.4, 12.9, 13.3, 13.8, 14.1, 14.5, 14.8, 15.0, 15.2] },
  },
];

export function getClient(slug: string): Client | undefined {
  return CLIENTS.find((c) => c.slug === slug);
}

export const SERVICE_LABEL: Record<Service, string> = {
  ads: "Paid Ads",
  socials: "Social",
  web: "Web & SEO",
  seo: "SEO",
};
