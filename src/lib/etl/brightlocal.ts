/**
 * Minimal BrightLocal client for the Local Search Grid (geo-grid) read API.
 *
 * BrightLocal's geo-grid data is exposed through their hosted MCP gateway
 * (https://mcp.brightlocal.com) — a JSON-RPC-over-HTTP server — rather than a
 * documented REST path we can rely on, so the ETL speaks MCP to it server-to-
 * server. We only ever READ (find/get tools); runs are created + scheduled in
 * BrightLocal itself, so nothing here consumes LSG credits.
 *
 * Protocol: streamable-HTTP MCP. One short-lived session per call batch —
 * initialize (capture mcp-session-id) → notifications/initialized → tools/call.
 * Responses come back as SSE (`event: message` / `data: {json}`), so we parse
 * the data line. Tool results carry their payload as a JSON string in
 * result.content[0].text.
 *
 * Self-contained (no app imports) so it can be smoke-tested in isolation.
 */
const MCP_URL = "https://mcp.brightlocal.com/mcp";
const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcResponse = { result?: unknown; error?: { code: number; message: string } };

/** Pull the JSON-RPC envelope out of either a plain-JSON or an SSE response. */
function parseBody(text: string): JsonRpcResponse {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as JsonRpcResponse;
  // SSE: take the last non-empty `data:` line and parse it.
  const data = trimmed
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  const last = data[data.length - 1];
  if (!last) throw new Error("BrightLocal: empty MCP response");
  return JSON.parse(last) as JsonRpcResponse;
}

function headers(key: string, sessionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "x-api-key": key,
  };
  if (sessionId) {
    h["mcp-session-id"] = sessionId;
    h["MCP-Protocol-Version"] = PROTOCOL_VERSION;
  }
  return h;
}

async function post(key: string, body: unknown, sessionId?: string): Promise<Response> {
  return fetch(`${MCP_URL}?api-key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: headers(key, sessionId),
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export type BrightLocalCall = <T = unknown>(tool: string, args: Record<string, unknown>) => Promise<T>;

/**
 * Open a BrightLocal MCP session, run `fn` with a `call(tool, args)` helper, and
 * tear down. Throws if BRIGHTLOCAL_API_KEY is unset or the handshake fails;
 * individual tool errors reject the specific call.
 */
export async function withBrightLocal<T>(fn: (call: BrightLocalCall) => Promise<T>): Promise<T> {
  const key = process.env.BRIGHTLOCAL_API_KEY;
  if (!key) throw new Error("BRIGHTLOCAL_API_KEY is not set");

  // 1) initialize → session id from the response header
  const initRes = await post(key, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "posted-tracker", version: "1.0" } },
  });
  const sessionId = initRes.headers.get("mcp-session-id") ?? undefined;
  await initRes.text(); // drain
  if (!sessionId) throw new Error("BrightLocal: no MCP session id returned");

  // 2) initialized notification (no id)
  await post(key, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId).then((r) => r.text());

  // 3) tool caller — unwraps result.content[0].text (a JSON string)
  const call: BrightLocalCall = async <R = unknown>(tool: string, args: Record<string, unknown>): Promise<R> => {
    const res = await post(key, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }, sessionId);
    const env = parseBody(await res.text());
    if (env.error) throw new Error(`BrightLocal ${tool}: ${env.error.message}`);
    const content = (env.result as { content?: { text?: string }[] } | undefined)?.content;
    const text = content?.[0]?.text;
    return (text ? JSON.parse(text) : env.result) as R;
  };

  return fn(call);
}

// ── typed shapes for the Local Search Grid read tools we use ─────────────────
export type LsgKeyword = { id: number; keyword: string };
export type LsgReport = {
  report_id: number;
  location_id: number;
  grid_size: string;          // e.g. "7x7"
  grid_point_spacing: string; // e.g. "2mi"
  business_geo_coordinates: { latitude: number; longitude: number };
  grid_center_geo_coordinates: { latitude: number; longitude: number };
  keywords: LsgKeyword[];
  last_run_id: number | null;
  gmb_info?: { name?: string; address?: string; cid?: string };
};
export type LsgGridPoint = { latitude: number; longitude: number; point_id: string; rank: number };
/** Per-run rollup. BrightLocal labels points high/med/low by rank band; avg_rank
 *  is the mean rank across the grid (lower = better). */
export type LsgSummary = {
  avg_rank?: number;
  num_points?: number;
  num_high_ranking_points?: number;
  num_med_ranking_points?: number;
  num_low_ranking_points?: number;
};
export type LsgRun = {
  run_id: number;
  keyword: string;
  status: string;
  start_date: string;
  end_date: string;
  grid_url?: string;
  grid_points: LsgGridPoint[];
  summary?: LsgSummary;
};
/** One row from get_lsg_report_runs (history list). Field names are defensive —
 *  the run-list item shape isn't documented; we read whichever id/date/avg is
 *  present and skip rows we can't key. */
export type LsgRunListItem = {
  run_id?: number;
  id?: number;
  start_date?: string;
  end_date?: string;
  run_date?: string;
  date?: string;
  summary?: LsgSummary;
  avg_rank?: number;
};

// NOTE: BrightLocal's MCP schema requires the numeric ids (report_id, run_id,
// keyword_id) as INTEGERS — it rejects strings with
// `… report_id: type: <id> has type "string", want "integer"`. So we coerce with
// Number(); only point_id (a UUID) stays a string. Do NOT switch these back to
// String().

/** Full report config (keywords + grid + center) for a given report id. */
export function getLsgReport(call: BrightLocalCall, reportId: string | number) {
  return call<LsgReport>("get_lsg_report", { report_id: Number(reportId) });
}
/** Latest finished run (grid points + ranks) for one keyword of a report. */
export function getLsgLatestRun(call: BrightLocalCall, reportId: string | number, keywordId: string | number) {
  return call<LsgRun>("get_lsg_latest_run", { report_id: Number(reportId), keyword_id: Number(keywordId) });
}
/** Historical run list for one keyword (newest first, paginated). Used by the
 *  backfill to seed the avg-rank-over-time trend; the daily pull just appends
 *  the latest run. Returns `{ items, total }`. */
export function getLsgReportRuns(call: BrightLocalCall, reportId: string | number, keywordId: string | number, page = 1, perPage = 100) {
  return call<{ items: LsgRunListItem[]; total: number }>("get_lsg_report_runs", {
    report_id: Number(reportId), keyword_id: Number(keywordId), num_per_page: perPage, page,
  });
}

/** Every Local Search Grid report in the account (paginated). Each item is a
 *  full report object (same shape as get_lsg_report). Powers the settings report
 *  picker — BrightLocal's UI only exposes LOCATION ids in its URLs, so the only
 *  way to surface report ids is this API. */
export function findLsgReports(call: BrightLocalCall, page = 1, perPage = 100) {
  return call<{ items: LsgReport[]; total: number }>("find_lsg_reports", { num_per_page: perPage, page });
}

/** One competitor row in the top-competitors table for a keyword run. */
export type LsgCompetitor = {
  rank: number;
  title: string;
  cid?: string;
  avg_rank?: number;
  authority?: number;
  links?: number;
  num_reviews?: number;
  review_rating?: number;
  primary_category?: string;
  profile_url?: string;
};
/** Top-ranking competitors across the grid for one keyword run (≈ top 10). */
export function getLsgCompetitors(call: BrightLocalCall, reportId: string | number, runId: string | number, keywordId: string | number) {
  return call<{ competitors: LsgCompetitor[]; keyword?: string; run_id?: number }>("get_lsg_competitors", {
    report_id: Number(reportId), run_id: Number(runId), keyword_id: Number(keywordId),
  });
}

/** One business ranked at a single grid point. `is_customer_business` flags the
 *  client's own GBP — used for the "top 3 + you" point popup. */
export type LsgPointBusiness = {
  rank: number;
  name: string;
  cid?: string;
  num_reviews?: number;
  review_rating?: number;
  profile_url?: string;
  is_customer_business?: boolean;
};
/** Full ranked business list at a specific grid point (for on-demand popups). */
export function getLsgPointResults(call: BrightLocalCall, reportId: string | number, runId: string | number, keywordId: string | number, pointId: string) {
  return call<{ items: LsgPointBusiness[] }>("get_lsg_point_results", {
    report_id: Number(reportId), run_id: Number(runId), keyword_id: Number(keywordId), point_id: pointId,
  });
}

/** Settings-friendly summary of one LSG report (what the picker dropdown shows). */
export type LsgReportSummary = { reportId: number; name: string; locationId: number; gridSize: string; numKeywords: number };
