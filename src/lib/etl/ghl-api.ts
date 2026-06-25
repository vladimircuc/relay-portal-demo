/**
 * Minimal LeadConnector HQ (GHL) API client.
 *
 * Only the read endpoints we actually need from server actions and ETL
 * routes — pipelines (for the onboarding wizard) and opportunity search
 * (used by the daily pull in Step 5).
 *
 * Always called from the server; tokens come out of Vault inside the
 * caller and are passed in here as plain strings. NEVER call from the
 * browser.
 */

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export type GhlStage = {
  id: string;
  name: string;
  position: number;
};

export type GhlPipeline = {
  id: string;
  name: string;
  stages: GhlStage[];
};

function ghlHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_API_VERSION,
    Accept: "application/json",
  };
}

/**
 * Shape of a single opportunity from /opportunities/search. Lots of
 * optional fields because GHL's payload varies by location config.
 */
export type GhlOpportunity = {
  id: string;
  name?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  status?: string;
  source?: string;
  assignedTo?: string;
  monetaryValue?: number | string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Reference to a location-configured lost reason (only set on status="lost"
   *  opps). It's an opaque id — resolve to a human label via fetchGhlLostReasons. */
  lostReasonId?: string | null;
  contact?: {
    name?: string;
    phone?: string;
    email?: string;
    tags?: string[];
  };
};

/**
 * Paginate through every opportunity for a location (optionally filtered
 * by pipeline). Mirrors the original `ghl-daily.gs` Apps Script — 100/page,
 * small delay between pages so we don't hammer their rate limit.
 *
 * The Apps Script used 9 seconds between pages; we use a much smaller
 * default here because we're a real backend, not Google Apps Script
 * (which had its own quirky throttling). Caller can override via delayMs.
 *
 * NOTE: this endpoint uses snake_case params (`location_id`, `pipeline_id`)
 * unlike `/opportunities/pipelines` which uses camelCase. GHL's API is
 * inconsistent across endpoints; both are deliberate.
 */
export async function fetchGhlOpportunities(args: {
  token: string;
  locationId: string;
  pipelineId?: string | null;
  /** Items per page. GHL caps at 100; using a smaller value buys little. */
  pageLimit?: number;
  /** Pause between pages, ms. Defaults to 1500ms. */
  delayMs?: number;
  /** Hard cap to avoid runaway loops on misconfigured locations. */
  maxPages?: number;
}): Promise<GhlOpportunity[]> {
  const {
    token,
    locationId,
    pipelineId,
    pageLimit = 100,
    delayMs = 1500,
    maxPages = 100,
  } = args;

  const all: GhlOpportunity[] = [];
  let page = 1;

  while (page <= maxPages) {
    const params = new URLSearchParams({
      location_id: locationId,
      limit: String(pageLimit),
      page: String(page),
    });
    if (pipelineId) params.set("pipeline_id", pipelineId);

    const url = `${GHL_BASE}/opportunities/search?${params}`;
    const res = await fetch(url, {
      method: "GET",
      headers: ghlHeaders(token),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Asera opportunities request failed (${res.status}) on page ${page}: ${body.slice(0, 400)}`,
      );
    }
    const json = (await res.json()) as { opportunities?: GhlOpportunity[] };
    const opps = json.opportunities ?? [];
    all.push(...opps);

    // Stop conditions: empty page OR partial last page.
    if (opps.length === 0 || opps.length < pageLimit) break;

    page += 1;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }

  return all;
}

/**
 * List every pipeline (and its stages) for a location.
 *
 * Used by the onboarding wizard: paste token + location, hit "Discover
 * pipelines", get a dropdown of pipeline NAMES instead of UUIDs.
 *
 * Throws on non-2xx — callers should catch and surface the message.
 */
export async function fetchGhlPipelines(args: {
  token: string;
  locationId: string;
}): Promise<GhlPipeline[]> {
  const { token, locationId } = args;
  // NOTE: the pipelines endpoint expects camelCase `locationId`. The
  // opportunities/search endpoint wants snake_case `location_id`. GHL's
  // API is inconsistent across endpoints — don't blindly copy/paste.
  const url = `${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: ghlHeaders(token),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asera pipelines request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { pipelines?: GhlPipeline[] };

  // Sort by name for stable ordering in the dropdown. Stages within a
  // pipeline keep their GHL `position` order.
  const pipelines = (json.pipelines ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    stages: [...(p.stages ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  }));
  pipelines.sort((a, b) => a.name.localeCompare(b.name));
  return pipelines;
}

export type GhlLostReason = {
  id: string;
  name: string;
};

/**
 * List a location's configured opportunity "lost reasons".
 *
 * An opportunity carries only `lostReasonId` (an opaque id); this endpoint
 * turns those ids into human labels ("Too expensive", "Went with competitor",
 * …). The lost-reasons "by reason" donut resolves ids → names with this.
 *
 * NOTE: like /opportunities/pipelines (and UNLIKE /opportunities/search) this
 * endpoint expects camelCase `locationId`. GHL's API is inconsistent across
 * endpoints — don't blindly copy the snake_case `location_id` from the search
 * call. Scope required: opportunities.readonly (same as the opp search we
 * already do, so an existing GHL token works).
 */
export async function fetchGhlLostReasons(args: {
  token: string;
  locationId: string;
}): Promise<GhlLostReason[]> {
  const { token, locationId } = args;
  const url =
    `${GHL_BASE}/opportunities/lost-reason` +
    `?locationId=${encodeURIComponent(locationId)}&limit=100`;

  const res = await fetch(url, {
    method: "GET",
    headers: ghlHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asera lost-reason request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  // GHL returns each reason as { _id, name, locationId, ... } — note the
  // Mongo-style `_id`, NOT `id` (unlike pipelines/opportunities which use `id`).
  // Read `_id` first and fall back to `id` so we still work if a future API
  // version normalizes the field. Missing this is what made the donut show
  // "Unknown reason (…)" for every slice: the old code filtered on `r.id`,
  // which was always undefined, so the whole list was dropped.
  const json = (await res.json()) as {
    lostReasons?: Array<{ _id?: string; id?: string; name?: string }>;
  };
  return (json.lostReasons ?? [])
    .map((r) => ({ id: r._id ?? r.id ?? "", name: r.name ?? "" }))
    .filter((r): r is GhlLostReason => r.id.length > 0)
    .map((r) => ({ id: r.id, name: r.name || r.id }));
}
