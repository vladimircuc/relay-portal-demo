/**
 * Database row types matching the schema in dashboard/schema.sql.
 * Kept hand-written instead of using supabase-gen for now since the schema
 * is small and we want to control which fields are exposed to the client.
 */

export type DailyMetricsRow = {
  client_id: string;
  day: string;              // ISO date 'YYYY-MM-DD'
  spend: number;
  impressions: number;
  link_clicks: number;
  reach: number;
  frequency: number;
  cpm: number;
  cpc: number;
  ctr: number;
  meta_results: number | null;
  leads: number;
  bookings: number;
  no_shows: number;
  shows: number;
  conversions: number;
  revenue: number;
};

export type ClientRow = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  brand_logo_url: string | null;
  brand_accent_color: string;
  status: "active" | "paused" | "deleted";
  created_at: string;
};

export type MetricTier = "simple" | "advanced";
