-- =============================================================================
-- Posted Social client dashboard - multi-tenant schema (Supabase Postgres)
-- =============================================================================
-- GENERATED FROM LIVE on 2026-06-08 via:
--   pg_dump --schema-only --schema=public --no-owner
--
-- This is the canonical full schema, regenerated from production so it matches
-- live exactly: every table, function, the daily_metrics_v view, all RLS
-- policies, and grants. It supersedes the old hand-maintained baseline, which
-- had drifted ~15 migrations behind live. The migrations/ deltas (001-032)
-- remain the historical record of how we got here.
--
-- To rebuild from scratch: run this once in the Supabase SQL editor on a fresh
-- project. SCHEMA-ONLY: it contains NO row data, so you must seed your own
-- config/admin rows afterward (e.g. app_admin_emails for super-admin access,
-- plus client + client_credentials rows).
--
-- Three pg_dump artifacts were stripped so it runs cleanly in the Supabase SQL
-- editor (none change the resulting schema): the psql \restrict / \unrestrict
-- wrappers, and `CREATE SCHEMA public;` (public already exists on Supabase).
-- =============================================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: admin_capability; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.admin_capability AS ENUM (
    'ads',
    'socials'
);


--
-- Name: accessible_client_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.accessible_client_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE
    AS $$
  select id from clients where is_admin()
  union
  select client_id from client_domains
   where email_domain = current_user_email_domain()
  union
  select client_id from client_allowed_emails
   where email = current_user_email();
$$;


--
-- Name: admin_delete_secret(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_secret(secret_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
begin
  delete from vault.secrets where id = secret_id;
end;
$$;


--
-- Name: admin_get_secret(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_secret(secret_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  v text;
begin
  select decrypted_secret
    into v
    from vault.decrypted_secrets
   where id = secret_id;
  return v;
end;
$$;


--
-- Name: admin_set_secret(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_secret(existing_id uuid, secret_value text, secret_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
declare
  new_id uuid;
begin
  if existing_id is null then
    select vault.create_secret(secret_value, secret_name) into new_id;
    return new_id;
  else
    perform vault.update_secret(existing_id, secret_value);
    return existing_id;
  end if;
end;
$$;


--
-- Name: count_opps_for_phase(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.count_opps_for_phase(p_client_id uuid, p_day date, p_phase_key text) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  select count(*)::int
    from ghl_opportunities o
    join clients c on c.id = o.client_id
    join client_lifecycle_phases p
      on p.client_id = o.client_id and p.phase_key = p_phase_key
   where o.client_id = p_client_id
     and (o.created_at_ghl at time zone c.timezone)::date = p_day
     and o.pipeline_stage_id = any(p.pipeline_stage_ids)
     and (not c.ads_meta_source_only or is_meta_lead(o.source))
     and (p_phase_key <> 'converted' or lower(o.status) in ('open', 'won'));
$$;


--
-- Name: current_user_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select lower(auth.jwt() ->> 'email');
$$;


--
-- Name: current_user_email_domain(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_email_domain() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select lower(split_part((auth.jwt() ->> 'email'), '@', 2));
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select
    is_super_admin()
    or current_user_email_domain() =
         (select value from app_config where key = 'admin_domain')
    or exists (
      select 1 from app_admin_emails
       where email = current_user_email()
         and role  = 'admin'
    );
$$;


--
-- Name: is_meta_lead(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_meta_lead(p_source text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select coalesce(lower(ltrim(p_source)) like 'meta%', false);
$$;


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select exists (
    select 1 from app_admin_emails
     where email = current_user_email()
       and role  = 'super_admin'
  );
$$;


--
-- Name: sum_value_for_phase(uuid, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sum_value_for_phase(p_client_id uuid, p_day date, p_phase_key text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
  select coalesce(sum(o.monetary_value), 0)
    from ghl_opportunities o
    join clients c on c.id = o.client_id
    join client_lifecycle_phases p
      on p.client_id = o.client_id and p.phase_key = p_phase_key
   where o.client_id = p_client_id
     and (o.created_at_ghl at time zone c.timezone)::date = p_day
     and o.pipeline_stage_id = any(p.pipeline_stage_ids)
     and (not c.ads_meta_source_only or is_meta_lead(o.source))
     and (p_phase_key <> 'converted' or lower(o.status) in ('open', 'won'));
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_admin_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_admin_emails (
    email text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'super_admin'::text NOT NULL,
    CONSTRAINT app_admin_emails_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'super_admin'::text])))
);


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_allowed_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_allowed_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    email text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'viewer'::text NOT NULL,
    scopes public.admin_capability[],
    CONSTRAINT client_allowed_emails_role_check CHECK ((role = ANY (ARRAY['viewer'::text, 'local_super_admin'::text])))
);


--
-- Name: client_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_credentials (
    client_id uuid NOT NULL,
    meta_access_token_secret_id uuid,
    meta_ad_account_id text,
    meta_result_type text DEFAULT 'lead'::text NOT NULL,
    ghl_token_secret_id uuid,
    ghl_location_id text,
    ghl_pipeline_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_domains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    email_domain text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: client_lifecycle_phases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_lifecycle_phases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    phase_key text NOT NULL,
    display_label text NOT NULL,
    pipeline_stage_ids text[] NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status_filter text
);


--
-- Name: client_metric_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_metric_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    metric_key text NOT NULL,
    display_label text,
    is_visible boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: client_social_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_social_credentials (
    client_id uuid NOT NULL,
    platform text NOT NULL,
    access_token_secret_id uuid,
    fb_page_id text,
    fb_page_name text,
    ig_user_id text,
    ig_username text,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    youtube_channel_id text,
    youtube_channel_title text,
    youtube_channel_handle text,
    youtube_channel_thumbnail text,
    tiktok_open_id text,
    tiktok_union_id text,
    tiktok_username text,
    tiktok_display_name text,
    tiktok_avatar_url text,
    linkedin_org_urn text,
    linkedin_org_name text,
    linkedin_org_logo_url text,
    linkedin_vanity_name text,
    CONSTRAINT client_social_credentials_platform_check CHECK ((platform = ANY (ARRAY['meta'::text, 'linkedin'::text, 'tiktok'::text, 'youtube'::text])))
);


--
-- Name: TABLE client_social_credentials; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_social_credentials IS 'Per-client per-platform OAuth credentials for the Socials module. Separate from client_credentials (which holds Meta-Ads + GHL).';


--
-- Name: COLUMN client_social_credentials.access_token_secret_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.access_token_secret_id IS 'UUID into vault.secrets. For Meta = long-lived PAGE access token. Read via admin_get_secret().';


--
-- Name: COLUMN client_social_credentials.fb_page_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.fb_page_id IS 'Facebook Page selected during OAuth. Page tokens are bound to this page.';


--
-- Name: COLUMN client_social_credentials.ig_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.ig_user_id IS 'Instagram Business Account ID linked to the selected Page. NULL when the Page has no IG.';


--
-- Name: COLUMN client_social_credentials.youtube_channel_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.youtube_channel_id IS 'YouTube channel ID (e.g. UCxxx...). Stable identifier.';


--
-- Name: COLUMN client_social_credentials.youtube_channel_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.youtube_channel_title IS 'Channel display name shown in the admin UI.';


--
-- Name: COLUMN client_social_credentials.youtube_channel_handle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.youtube_channel_handle IS 'YouTube @handle (without the @). Optional — some channels still don''t have one.';


--
-- Name: COLUMN client_social_credentials.youtube_channel_thumbnail; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.youtube_channel_thumbnail IS 'CDN URL for the channel profile thumbnail.';


--
-- Name: COLUMN client_social_credentials.tiktok_open_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.tiktok_open_id IS 'TikTok open_id — stable per-app user identifier. Use this as the lookup key for API calls.';


--
-- Name: COLUMN client_social_credentials.tiktok_union_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.tiktok_union_id IS 'TikTok union_id — same user across multiple apps owned by one developer. Optional.';


--
-- Name: COLUMN client_social_credentials.tiktok_username; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.tiktok_username IS 'TikTok @handle (without the @).';


--
-- Name: COLUMN client_social_credentials.tiktok_display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.tiktok_display_name IS 'TikTok account display name shown in the admin UI.';


--
-- Name: COLUMN client_social_credentials.linkedin_org_urn; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.linkedin_org_urn IS 'LinkedIn organization URN (urn:li:organization:<id>). Use as the lookup key for Company Page API calls.';


--
-- Name: COLUMN client_social_credentials.linkedin_org_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.linkedin_org_name IS 'LinkedIn Company Page display name.';


--
-- Name: COLUMN client_social_credentials.linkedin_vanity_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_social_credentials.linkedin_vanity_name IS 'LinkedIn vanity URL slug (linkedin.com/company/<vanityName>). Optional.';


--
-- Name: client_tiktok_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_tiktok_videos (
    client_id uuid NOT NULL,
    videos jsonb DEFAULT '[]'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id text
);


--
-- Name: TABLE client_tiktok_videos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_tiktok_videos IS 'Latest snapshot of a client''s recent TikTok videos (cumulative per-video stats + post time). Powers the TikTok scorecard''s period-aware aggregates (videos posted in range, avg views, engagement rate). Overwritten daily by lib/etl/social.ts.';


--
-- Name: COLUMN client_tiktok_videos.account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_tiktok_videos.account_id IS 'TikTok open_id the snapshot belongs to. The posts pull stamps social_posts from THIS id so a stale snapshot (account just switched) attributes videos correctly; refreshed on the next daily pull. Nullable.';


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    timezone text DEFAULT 'America/Chicago'::text NOT NULL,
    brand_logo_url text,
    brand_accent_color text DEFAULT '#FFD100'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    goal_lead_to_booking numeric,
    goal_show_rate numeric,
    goal_show_to_conversion numeric,
    funnel_label_booking text DEFAULT 'Booking'::text NOT NULL,
    funnel_label_show text DEFAULT 'Show'::text NOT NULL,
    revenue_per_show numeric DEFAULT 0 NOT NULL,
    enabled_services public.admin_capability[] DEFAULT ARRAY['ads'::public.admin_capability] NOT NULL,
    ads_meta_source_only boolean DEFAULT true NOT NULL,
    CONSTRAINT clients_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'deleted'::text])))
);


--
-- Name: COLUMN clients.goal_lead_to_booking; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.goal_lead_to_booking IS 'Target Bookings / Leads, decimal 0..1';


--
-- Name: COLUMN clients.goal_show_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.goal_show_rate IS 'Target Shows / Bookings, decimal 0..1';


--
-- Name: COLUMN clients.goal_show_to_conversion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.goal_show_to_conversion IS 'Target Conversions / Shows, decimal 0..1';


--
-- Name: COLUMN clients.funnel_label_booking; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.funnel_label_booking IS 'Display label for funnel stage 2 (booked appointment)';


--
-- Name: COLUMN clients.funnel_label_show; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.funnel_label_show IS 'Display label for funnel stage 3 (appointment held)';


--
-- Name: COLUMN clients.revenue_per_show; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.revenue_per_show IS 'Flat revenue per held appointment (Show), added on top of converted opportunity lead_values. 0 = no surcharge (default). Used for clinics with a paid initial consultation.';


--
-- Name: COLUMN clients.enabled_services; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.enabled_services IS 'Products this client is entitled to (subset of admin_capability: ads, socials). Single source of truth for which dashboard tabs render and what local admins can manage (a local admin''s scopes are intersected with this). Set explicitly at onboarding; defaults to {ads}.';


--
-- Name: COLUMN clients.ads_meta_source_only; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.ads_meta_source_only IS 'When true (default), the Ads dashboard counts only Meta-sourced GHL opportunities (source ILIKE ''meta%''). False = count every lead source (for clients whose GHL source field is not the standard "Meta - <ad>" convention, e.g. STL Sports Clinic, fed by Meta {{site_source_name}}).';


--
-- Name: ghl_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ghl_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    ghl_id text NOT NULL,
    created_at_ghl timestamp with time zone NOT NULL,
    updated_at_ghl timestamp with time zone,
    opportunity_name text,
    contact_name text,
    contact_phone text,
    contact_email text,
    monetary_value numeric DEFAULT 0 NOT NULL,
    source text,
    assigned_to text,
    tags text[],
    status text,
    pipeline_stage_id text,
    pipeline_id text,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: meta_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meta_daily (
    client_id uuid NOT NULL,
    day date NOT NULL,
    reach numeric DEFAULT 0,
    impressions numeric DEFAULT 0,
    frequency numeric DEFAULT 0,
    link_clicks numeric DEFAULT 0,
    cpm numeric DEFAULT 0,
    cpc numeric DEFAULT 0,
    ctr numeric DEFAULT 0,
    spend numeric DEFAULT 0 NOT NULL,
    results numeric,
    cost_per_result numeric,
    raw_actions jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_metrics_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.daily_metrics_v AS
 WITH opp_counts AS (
         SELECT o.client_id,
            ((o.created_at_ghl AT TIME ZONE c_1.timezone))::date AS day,
            count(*) AS ghl_lead_count
           FROM (public.ghl_opportunities o
             JOIN public.clients c_1 ON ((c_1.id = o.client_id)))
          WHERE ((NOT c_1.ads_meta_source_only) OR public.is_meta_lead(o.source))
          GROUP BY o.client_id, (((o.created_at_ghl AT TIME ZONE c_1.timezone))::date)
        )
 SELECT COALESCE(m.client_id, oc.client_id) AS client_id,
    COALESCE(m.day, oc.day) AS day,
    COALESCE(m.spend, (0)::numeric) AS spend,
    COALESCE(m.impressions, (0)::numeric) AS impressions,
    COALESCE(m.link_clicks, (0)::numeric) AS link_clicks,
    COALESCE(m.reach, (0)::numeric) AS reach,
    COALESCE(m.frequency, (0)::numeric) AS frequency,
    COALESCE(m.cpm, (0)::numeric) AS cpm,
    COALESCE(m.cpc, (0)::numeric) AS cpc,
    COALESCE(m.ctr, (0)::numeric) AS ctr,
    m.results AS meta_results,
    COALESCE(oc.ghl_lead_count, (0)::bigint) AS leads,
    public.count_opps_for_phase(COALESCE(m.client_id, oc.client_id), COALESCE(m.day, oc.day), 'booked'::text) AS bookings,
    public.count_opps_for_phase(COALESCE(m.client_id, oc.client_id), COALESCE(m.day, oc.day), 'no_show'::text) AS no_shows,
    public.count_opps_for_phase(COALESCE(m.client_id, oc.client_id), COALESCE(m.day, oc.day), 'showed'::text) AS shows,
    public.count_opps_for_phase(COALESCE(m.client_id, oc.client_id), COALESCE(m.day, oc.day), 'converted'::text) AS conversions,
    (public.sum_value_for_phase(COALESCE(m.client_id, oc.client_id), COALESCE(m.day, oc.day), 'converted'::text) + (COALESCE(c.revenue_per_show, (0)::numeric) * (public.count_opps_for_phase(COALESCE(m.client_id, oc.client_id), COALESCE(m.day, oc.day), 'showed'::text))::numeric)) AS revenue
   FROM ((public.meta_daily m
     FULL JOIN opp_counts oc ON (((oc.client_id = m.client_id) AND (oc.day = m.day))))
     LEFT JOIN public.clients c ON ((c.id = COALESCE(m.client_id, oc.client_id))));


--
-- Name: etl_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.etl_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    source text NOT NULL,
    status text NOT NULL,
    rows_written integer,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    error_message text,
    CONSTRAINT etl_runs_source_check CHECK ((source = ANY (ARRAY['meta_daily'::text, 'meta_backfill'::text, 'ghl_full'::text, 'social_daily'::text, 'social_backfill'::text, 'social_posts'::text]))),
    CONSTRAINT etl_runs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failure'::text, 'partial'::text])))
);


--
-- Name: social_backfill_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_backfill_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    platform text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    earliest_day date,
    latest_day date,
    rows_written integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id text,
    CONSTRAINT social_backfill_jobs_platform_check CHECK ((platform = ANY (ARRAY['meta_facebook'::text, 'meta_instagram'::text, 'youtube'::text, 'tiktok'::text, 'linkedin'::text]))),
    CONSTRAINT social_backfill_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'error'::text])))
);


--
-- Name: TABLE social_backfill_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.social_backfill_jobs IS 'Tracks on-connect historical backfill of social_daily_metrics per client/platform (status, window covered, errors). Drives "backfilling…" UI and retry/resume.';


--
-- Name: COLUMN social_backfill_jobs.account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_backfill_jobs.account_id IS 'Platform account id this backfill ran for (fb_page_id / ig_user_id / youtube_channel_id / tiktok_open_id). Record-keeping only; nullable.';


--
-- Name: social_daily_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_daily_metrics (
    client_id uuid NOT NULL,
    platform text NOT NULL,
    day date NOT NULL,
    followers bigint,
    followers_delta bigint,
    impressions bigint,
    engagements bigint,
    profile_visits bigint,
    link_clicks bigint,
    posts_count bigint,
    raw jsonb,
    source text DEFAULT 'cron'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    follows_gained bigint,
    reach bigint,
    watch_time_minutes bigint,
    account_id text NOT NULL,
    shares bigint,
    CONSTRAINT social_daily_metrics_platform_check CHECK ((platform = ANY (ARRAY['meta_facebook'::text, 'meta_instagram'::text, 'youtube'::text, 'tiktok'::text, 'linkedin'::text]))),
    CONSTRAINT social_daily_metrics_source_check CHECK ((source = ANY (ARRAY['backfill'::text, 'cron'::text, 'manual'::text])))
);


--
-- Name: TABLE social_daily_metrics; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.social_daily_metrics IS 'Per-client per-platform DAILY social metrics. Backing store for the /socials chart, tiles, and period selector. Written by lib/etl/social.ts (cron + on-connect backfill).';


--
-- Name: COLUMN social_daily_metrics.followers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_daily_metrics.followers IS 'Absolute end-of-day follower/subscriber count (snapshot). Chart plots this; change = last − first.';


--
-- Name: COLUMN social_daily_metrics.impressions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_daily_metrics.impressions IS 'Daily impressions/views (NOT cumulative) — summing a range gives the period total.';


--
-- Name: COLUMN social_daily_metrics.raw; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_daily_metrics.raw IS 'Raw API payload for this platform/day so metrics can be re-derived without re-fetching.';


--
-- Name: COLUMN social_daily_metrics.follows_gained; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_daily_metrics.follows_gained IS 'Gross new follows that day (matches Business Suite "Follows"). FB page_daily_follows_unique / IG follower_count / YT subscribersGained. Sum over a range = follows gained in period.';


--
-- Name: COLUMN social_daily_metrics.reach; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_daily_metrics.reach IS 'Daily unique accounts reached (Instagram; null elsewhere). Distinct from impressions, which counts repeats.';


--
-- Name: COLUMN social_daily_metrics.watch_time_minutes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_daily_metrics.watch_time_minutes IS 'Daily estimated minutes watched (YouTube; null elsewhere). Avg view duration is derived as watch_time / views.';


--
-- Name: COLUMN social_daily_metrics.account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_daily_metrics.account_id IS 'Stable platform account id that produced this row (fb_page_id / ig_user_id / youtube_channel_id / tiktok_open_id). Part of the PK so reconnecting a DIFFERENT account starts a separate series instead of overwriting. Reads scope to the currently-connected account in client_social_credentials; other accounts'' rows are retained but dormant.';


--
-- Name: COLUMN social_daily_metrics.shares; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_daily_metrics.shares IS 'Daily share count for the day (currently YouTube only, from the YT Analytics `shares` metric). Summed over the selected range to drive the YouTube "Shares" breakdown tile. Nullable — Facebook/Instagram fold shares into engagements and surface them from social_posts.shares instead.';


--
-- Name: social_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_posts (
    client_id uuid NOT NULL,
    platform text NOT NULL,
    post_id text NOT NULL,
    posted_at timestamp with time zone NOT NULL,
    permalink text,
    thumbnail_url text,
    caption text,
    media_type text,
    reach_kind text,
    reach bigint,
    engagements bigint,
    likes bigint,
    comments bigint,
    shares bigint,
    raw jsonb,
    source text DEFAULT 'cron'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id text NOT NULL,
    saves bigint,
    CONSTRAINT social_posts_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text, 'reel'::text, 'carousel'::text, 'text'::text]))),
    CONSTRAINT social_posts_platform_check CHECK ((platform = ANY (ARRAY['meta_facebook'::text, 'meta_instagram'::text, 'youtube'::text, 'tiktok'::text, 'linkedin'::text]))),
    CONSTRAINT social_posts_reach_kind_check CHECK ((reach_kind = ANY (ARRAY['impressions'::text, 'plays'::text, 'views'::text]))),
    CONSTRAINT social_posts_source_check CHECK ((source = ANY (ARRAY['backfill'::text, 'cron'::text, 'manual'::text])))
);


--
-- Name: TABLE social_posts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.social_posts IS 'Per-client per-platform individual social POSTS. Backing store for the /socials "Top performing content" cards. Written by lib/etl/social-posts.ts (cron + on-connect backfill); ranked by reach or engagements over a date range.';


--
-- Name: COLUMN social_posts.reach; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_posts.reach IS 'Cumulative impressions/plays/views for this post (reach_kind says which). Nullable — FB/IG fetch it via a per-post insights call that may be ungated.';


--
-- Name: COLUMN social_posts.engagements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_posts.engagements IS 'Total interactions for this post (reactions/likes + comments + shares, or the platform total_interactions where richer).';


--
-- Name: COLUMN social_posts.account_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_posts.account_id IS 'Stable platform account id that produced this post (fb_page_id / ig_user_id / youtube_channel_id / tiktok_open_id). Reads scope to the currently-connected account; a different account''s posts are retained but dormant. Not in the PK (post_id is already globally unique per platform).';


--
-- Name: COLUMN social_posts.saves; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_posts.saves IS 'Number of saves the post earned (Instagram only — the `saved` media insight). Facebook/TikTok/YouTube leave this null (no API equivalent). Summed over posts in the range to drive the Instagram "Saves" breakdown tile.';


--
-- Name: app_admin_emails app_admin_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_admin_emails
    ADD CONSTRAINT app_admin_emails_pkey PRIMARY KEY (email);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);


--
-- Name: client_allowed_emails client_allowed_emails_client_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_allowed_emails
    ADD CONSTRAINT client_allowed_emails_client_id_email_key UNIQUE (client_id, email);


--
-- Name: client_allowed_emails client_allowed_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_allowed_emails
    ADD CONSTRAINT client_allowed_emails_pkey PRIMARY KEY (id);


--
-- Name: client_credentials client_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_credentials
    ADD CONSTRAINT client_credentials_pkey PRIMARY KEY (client_id);


--
-- Name: client_domains client_domains_email_domain_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_domains
    ADD CONSTRAINT client_domains_email_domain_client_id_key UNIQUE (email_domain, client_id);


--
-- Name: client_domains client_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_domains
    ADD CONSTRAINT client_domains_pkey PRIMARY KEY (id);


--
-- Name: client_lifecycle_phases client_lifecycle_phases_client_id_phase_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_lifecycle_phases
    ADD CONSTRAINT client_lifecycle_phases_client_id_phase_key_key UNIQUE (client_id, phase_key);


--
-- Name: client_lifecycle_phases client_lifecycle_phases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_lifecycle_phases
    ADD CONSTRAINT client_lifecycle_phases_pkey PRIMARY KEY (id);


--
-- Name: client_metric_settings client_metric_settings_client_id_metric_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_metric_settings
    ADD CONSTRAINT client_metric_settings_client_id_metric_key_key UNIQUE (client_id, metric_key);


--
-- Name: client_metric_settings client_metric_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_metric_settings
    ADD CONSTRAINT client_metric_settings_pkey PRIMARY KEY (id);


--
-- Name: client_social_credentials client_social_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_credentials
    ADD CONSTRAINT client_social_credentials_pkey PRIMARY KEY (client_id, platform);


--
-- Name: client_tiktok_videos client_tiktok_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_tiktok_videos
    ADD CONSTRAINT client_tiktok_videos_pkey PRIMARY KEY (client_id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: clients clients_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_slug_key UNIQUE (slug);


--
-- Name: etl_runs etl_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_runs
    ADD CONSTRAINT etl_runs_pkey PRIMARY KEY (id);


--
-- Name: ghl_opportunities ghl_opportunities_client_id_ghl_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghl_opportunities
    ADD CONSTRAINT ghl_opportunities_client_id_ghl_id_key UNIQUE (client_id, ghl_id);


--
-- Name: ghl_opportunities ghl_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghl_opportunities
    ADD CONSTRAINT ghl_opportunities_pkey PRIMARY KEY (id);


--
-- Name: meta_daily meta_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_daily
    ADD CONSTRAINT meta_daily_pkey PRIMARY KEY (client_id, day);


--
-- Name: social_backfill_jobs social_backfill_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_backfill_jobs
    ADD CONSTRAINT social_backfill_jobs_pkey PRIMARY KEY (id);


--
-- Name: social_daily_metrics social_daily_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_daily_metrics
    ADD CONSTRAINT social_daily_metrics_pkey PRIMARY KEY (client_id, platform, account_id, day);


--
-- Name: social_posts social_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_pkey PRIMARY KEY (client_id, platform, post_id);


--
-- Name: client_allowed_emails_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_allowed_emails_email_idx ON public.client_allowed_emails USING btree (email);


--
-- Name: client_domains_email_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_domains_email_domain_idx ON public.client_domains USING btree (email_domain);


--
-- Name: client_lifecycle_phases_client_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_lifecycle_phases_client_id_idx ON public.client_lifecycle_phases USING btree (client_id);


--
-- Name: etl_runs_client_id_source_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX etl_runs_client_id_source_started_at_idx ON public.etl_runs USING btree (client_id, source, started_at DESC);


--
-- Name: ghl_opportunities_client_id_created_at_ghl_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghl_opportunities_client_id_created_at_ghl_idx ON public.ghl_opportunities USING btree (client_id, created_at_ghl);


--
-- Name: ghl_opportunities_client_id_pipeline_stage_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghl_opportunities_client_id_pipeline_stage_id_idx ON public.ghl_opportunities USING btree (client_id, pipeline_stage_id);


--
-- Name: ghl_opportunities_client_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghl_opportunities_client_id_status_idx ON public.ghl_opportunities USING btree (client_id, status);


--
-- Name: ghl_opps_client_source_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghl_opps_client_source_created ON public.ghl_opportunities USING btree (client_id, source, created_at_ghl);


--
-- Name: ghl_opps_client_stage_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ghl_opps_client_stage_created ON public.ghl_opportunities USING btree (client_id, pipeline_stage_id, created_at_ghl);


--
-- Name: meta_daily_client_id_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX meta_daily_client_id_day_idx ON public.meta_daily USING btree (client_id, day DESC);


--
-- Name: social_backfill_jobs_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_backfill_jobs_client_idx ON public.social_backfill_jobs USING btree (client_id, platform);


--
-- Name: social_daily_metrics_client_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_daily_metrics_client_day_idx ON public.social_daily_metrics USING btree (client_id, day);


--
-- Name: social_posts_client_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_posts_client_account_idx ON public.social_posts USING btree (client_id, platform, account_id);


--
-- Name: social_posts_client_posted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_posts_client_posted_idx ON public.social_posts USING btree (client_id, posted_at DESC);


--
-- Name: client_allowed_emails client_allowed_emails_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_allowed_emails
    ADD CONSTRAINT client_allowed_emails_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_credentials client_credentials_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_credentials
    ADD CONSTRAINT client_credentials_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_domains client_domains_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_domains
    ADD CONSTRAINT client_domains_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_lifecycle_phases client_lifecycle_phases_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_lifecycle_phases
    ADD CONSTRAINT client_lifecycle_phases_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_metric_settings client_metric_settings_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_metric_settings
    ADD CONSTRAINT client_metric_settings_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_social_credentials client_social_credentials_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_social_credentials
    ADD CONSTRAINT client_social_credentials_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_tiktok_videos client_tiktok_videos_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_tiktok_videos
    ADD CONSTRAINT client_tiktok_videos_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: etl_runs etl_runs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.etl_runs
    ADD CONSTRAINT etl_runs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: ghl_opportunities ghl_opportunities_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ghl_opportunities
    ADD CONSTRAINT ghl_opportunities_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: meta_daily meta_daily_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meta_daily
    ADD CONSTRAINT meta_daily_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: social_backfill_jobs social_backfill_jobs_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_backfill_jobs
    ADD CONSTRAINT social_backfill_jobs_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: social_daily_metrics social_daily_metrics_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_daily_metrics
    ADD CONSTRAINT social_daily_metrics_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: social_posts social_posts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: app_admin_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_admin_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: app_admin_emails app_admin_emails_super_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_admin_emails_super_only ON public.app_admin_emails USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: app_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

--
-- Name: app_config app_config_super_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_config_super_only ON public.app_config FOR SELECT USING (public.is_super_admin());


--
-- Name: app_config app_config_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_config_write ON public.app_config USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: client_allowed_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_allowed_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: client_allowed_emails client_allowed_emails_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_allowed_emails_read ON public.client_allowed_emails FOR SELECT USING ((public.is_super_admin() OR (client_id IN ( SELECT public.accessible_client_ids() AS accessible_client_ids))));


--
-- Name: client_allowed_emails client_allowed_emails_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_allowed_emails_write ON public.client_allowed_emails USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: client_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: client_credentials client_credentials_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_credentials_write ON public.client_credentials USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: client_domains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: client_domains client_domains_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_domains_read ON public.client_domains FOR SELECT USING ((public.is_super_admin() OR (client_id IN ( SELECT public.accessible_client_ids() AS accessible_client_ids))));


--
-- Name: client_domains client_domains_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_domains_write ON public.client_domains USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: client_lifecycle_phases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_lifecycle_phases ENABLE ROW LEVEL SECURITY;

--
-- Name: client_lifecycle_phases client_lifecycle_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_lifecycle_read ON public.client_lifecycle_phases FOR SELECT USING ((public.is_super_admin() OR (client_id IN ( SELECT public.accessible_client_ids() AS accessible_client_ids))));


--
-- Name: client_lifecycle_phases client_lifecycle_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_lifecycle_write ON public.client_lifecycle_phases USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: client_metric_settings client_metric_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_metric_read ON public.client_metric_settings FOR SELECT USING ((public.is_super_admin() OR (client_id IN ( SELECT public.accessible_client_ids() AS accessible_client_ids))));


--
-- Name: client_metric_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_metric_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: client_metric_settings client_metric_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_metric_write ON public.client_metric_settings USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: client_social_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_social_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: client_tiktok_videos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_tiktok_videos ENABLE ROW LEVEL SECURITY;

--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: clients clients_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_read ON public.clients FOR SELECT USING ((public.is_super_admin() OR (id IN ( SELECT public.accessible_client_ids() AS accessible_client_ids))));


--
-- Name: clients clients_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_write ON public.clients USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: client_credentials credentials_super_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY credentials_super_only ON public.client_credentials FOR SELECT USING (public.is_super_admin());


--
-- Name: etl_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.etl_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: etl_runs etl_runs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY etl_runs_read ON public.etl_runs FOR SELECT USING ((public.is_super_admin() OR (client_id IN ( SELECT public.accessible_client_ids() AS accessible_client_ids))));


--
-- Name: etl_runs etl_runs_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY etl_runs_write ON public.etl_runs USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: ghl_opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ghl_opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: ghl_opportunities ghl_opps_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ghl_opps_read ON public.ghl_opportunities FOR SELECT USING ((public.is_super_admin() OR (client_id IN ( SELECT public.accessible_client_ids() AS accessible_client_ids))));


--
-- Name: ghl_opportunities ghl_opps_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ghl_opps_write ON public.ghl_opportunities USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: meta_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meta_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: meta_daily meta_daily_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meta_daily_read ON public.meta_daily FOR SELECT USING ((public.is_super_admin() OR (client_id IN ( SELECT public.accessible_client_ids() AS accessible_client_ids))));


--
-- Name: meta_daily meta_daily_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meta_daily_write ON public.meta_daily USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());


--
-- Name: social_backfill_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_backfill_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: social_daily_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_daily_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: social_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION accessible_client_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.accessible_client_ids() TO anon;
GRANT ALL ON FUNCTION public.accessible_client_ids() TO authenticated;
GRANT ALL ON FUNCTION public.accessible_client_ids() TO service_role;


--
-- Name: FUNCTION admin_delete_secret(secret_id uuid); Type: ACL; Schema: public; Owner: -
--

-- SECURITY (audit 2026): SECURITY DEFINER + no in-body guard → service_role ONLY.
-- Never grant anon/authenticated (they hold the public key / a low-priv session).
REVOKE ALL ON FUNCTION public.admin_delete_secret(secret_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.admin_delete_secret(secret_id uuid) TO service_role;


--
-- Name: FUNCTION admin_get_secret(secret_id uuid); Type: ACL; Schema: public; Owner: -
--

-- SECURITY (audit 2026): SECURITY DEFINER + no in-body guard → service_role ONLY.
-- Never grant anon/authenticated (they hold the public key / a low-priv session).
REVOKE ALL ON FUNCTION public.admin_get_secret(secret_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.admin_get_secret(secret_id uuid) TO service_role;


--
-- Name: FUNCTION admin_set_secret(existing_id uuid, secret_value text, secret_name text); Type: ACL; Schema: public; Owner: -
--

-- SECURITY (audit 2026): SECURITY DEFINER + no in-body guard → service_role ONLY.
-- Never grant anon/authenticated (they hold the public key / a low-priv session).
REVOKE ALL ON FUNCTION public.admin_set_secret(existing_id uuid, secret_value text, secret_name text) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.admin_set_secret(existing_id uuid, secret_value text, secret_name text) TO service_role;


--
-- Name: FUNCTION count_opps_for_phase(p_client_id uuid, p_day date, p_phase_key text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.count_opps_for_phase(p_client_id uuid, p_day date, p_phase_key text) TO anon;
GRANT ALL ON FUNCTION public.count_opps_for_phase(p_client_id uuid, p_day date, p_phase_key text) TO authenticated;
GRANT ALL ON FUNCTION public.count_opps_for_phase(p_client_id uuid, p_day date, p_phase_key text) TO service_role;


--
-- Name: FUNCTION current_user_email(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_user_email() TO anon;
GRANT ALL ON FUNCTION public.current_user_email() TO authenticated;
GRANT ALL ON FUNCTION public.current_user_email() TO service_role;


--
-- Name: FUNCTION current_user_email_domain(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_user_email_domain() TO anon;
GRANT ALL ON FUNCTION public.current_user_email_domain() TO authenticated;
GRANT ALL ON FUNCTION public.current_user_email_domain() TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin() TO anon;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION is_meta_lead(p_source text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_meta_lead(p_source text) TO anon;
GRANT ALL ON FUNCTION public.is_meta_lead(p_source text) TO authenticated;
GRANT ALL ON FUNCTION public.is_meta_lead(p_source text) TO service_role;


--
-- Name: FUNCTION is_super_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_super_admin() TO anon;
GRANT ALL ON FUNCTION public.is_super_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_super_admin() TO service_role;


--
-- Name: FUNCTION sum_value_for_phase(p_client_id uuid, p_day date, p_phase_key text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sum_value_for_phase(p_client_id uuid, p_day date, p_phase_key text) TO anon;
GRANT ALL ON FUNCTION public.sum_value_for_phase(p_client_id uuid, p_day date, p_phase_key text) TO authenticated;
GRANT ALL ON FUNCTION public.sum_value_for_phase(p_client_id uuid, p_day date, p_phase_key text) TO service_role;


--
-- Name: TABLE app_admin_emails; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_admin_emails TO anon;
GRANT ALL ON TABLE public.app_admin_emails TO authenticated;
GRANT ALL ON TABLE public.app_admin_emails TO service_role;


--
-- Name: TABLE app_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_config TO anon;
GRANT ALL ON TABLE public.app_config TO authenticated;
GRANT ALL ON TABLE public.app_config TO service_role;


--
-- Name: TABLE client_allowed_emails; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_allowed_emails TO anon;
GRANT ALL ON TABLE public.client_allowed_emails TO authenticated;
GRANT ALL ON TABLE public.client_allowed_emails TO service_role;


--
-- Name: TABLE client_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_credentials TO anon;
GRANT ALL ON TABLE public.client_credentials TO authenticated;
GRANT ALL ON TABLE public.client_credentials TO service_role;


--
-- Name: TABLE client_domains; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_domains TO anon;
GRANT ALL ON TABLE public.client_domains TO authenticated;
GRANT ALL ON TABLE public.client_domains TO service_role;


--
-- Name: TABLE client_lifecycle_phases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_lifecycle_phases TO anon;
GRANT ALL ON TABLE public.client_lifecycle_phases TO authenticated;
GRANT ALL ON TABLE public.client_lifecycle_phases TO service_role;


--
-- Name: TABLE client_metric_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_metric_settings TO anon;
GRANT ALL ON TABLE public.client_metric_settings TO authenticated;
GRANT ALL ON TABLE public.client_metric_settings TO service_role;


--
-- Name: TABLE client_social_credentials; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_social_credentials TO anon;
GRANT ALL ON TABLE public.client_social_credentials TO authenticated;
GRANT ALL ON TABLE public.client_social_credentials TO service_role;


--
-- Name: TABLE client_tiktok_videos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_tiktok_videos TO anon;
GRANT ALL ON TABLE public.client_tiktok_videos TO authenticated;
GRANT ALL ON TABLE public.client_tiktok_videos TO service_role;


--
-- Name: TABLE clients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.clients TO anon;
GRANT ALL ON TABLE public.clients TO authenticated;
GRANT ALL ON TABLE public.clients TO service_role;


--
-- Name: TABLE ghl_opportunities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ghl_opportunities TO anon;
GRANT ALL ON TABLE public.ghl_opportunities TO authenticated;
GRANT ALL ON TABLE public.ghl_opportunities TO service_role;


--
-- Name: TABLE meta_daily; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.meta_daily TO anon;
GRANT ALL ON TABLE public.meta_daily TO authenticated;
GRANT ALL ON TABLE public.meta_daily TO service_role;


--
-- Name: TABLE daily_metrics_v; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.daily_metrics_v TO anon;
GRANT ALL ON TABLE public.daily_metrics_v TO authenticated;
GRANT ALL ON TABLE public.daily_metrics_v TO service_role;


--
-- Name: TABLE etl_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.etl_runs TO anon;
GRANT ALL ON TABLE public.etl_runs TO authenticated;
GRANT ALL ON TABLE public.etl_runs TO service_role;


--
-- Name: TABLE social_backfill_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.social_backfill_jobs TO anon;
GRANT ALL ON TABLE public.social_backfill_jobs TO authenticated;
GRANT ALL ON TABLE public.social_backfill_jobs TO service_role;


--
-- Name: TABLE social_daily_metrics; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.social_daily_metrics TO anon;
GRANT ALL ON TABLE public.social_daily_metrics TO authenticated;
GRANT ALL ON TABLE public.social_daily_metrics TO service_role;


--
-- Name: TABLE social_posts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.social_posts TO anon;
GRANT ALL ON TABLE public.social_posts TO authenticated;
GRANT ALL ON TABLE public.social_posts TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


