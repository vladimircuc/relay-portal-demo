/**
 * Probe every TikTok endpoint we care about for the Socials module
 * for a connected account, using the stored refresh_token.
 *
 * Run:
 *   cd dashboard/web
 *   npx tsx --env-file .env.local scripts/probe-tiktok-social.ts <clientSlug>
 *
 * Endpoints probed:
 *   - /v2/user/info/   → display name, avatar, follower / following /
 *                        likes / video counts (mapped via fields=)
 *   - /v2/video/list/  → recent videos with inline stats (view_count,
 *                        like_count, comment_count, share_count, etc.)
 *
 * IMPORTANT: TikTok's refresh endpoint AUTO-ROTATES the refresh_token —
 * every call returns a NEW refresh_token that supersedes the old one.
 * The probe persists the new one back to the Vault so the next probe
 * still works. (Without this, the second run would fail.)
 *
 * The token stays in process and is NEVER printed.
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret, setVaultSecret } from "../src/lib/etl/vault";
import { refreshAccessToken } from "../src/lib/tiktok-oauth";

const TT_OPEN = "https://open.tiktokapis.com/v2";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("usage: probe-tiktok-social.ts <clientSlug>");
    process.exit(1);
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error("Missing TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET in env");
  }

  const supabase = createAdminClient();
  const { data: client } = await supabase
    .from("clients").select("id").eq("slug", slug).maybeSingle();
  if (!client) throw new Error(`No client with slug ${slug}`);

  const { data: creds } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, tiktok_open_id, tiktok_username, tiktok_display_name")
    .eq("client_id", (client as { id: string }).id)
    .eq("platform", "tiktok")
    .maybeSingle();
  if (!creds) throw new Error("No TikTok credentials for this client");
  const c = creds as {
    access_token_secret_id: string;
    tiktok_open_id: string;
    tiktok_username: string | null;
    tiktok_display_name: string | null;
  };

  // Mint a fresh access token. TikTok rotates the refresh token on every
  // call, so we MUST persist the new one back to Vault — otherwise the
  // next probe run will fail.
  const oldRefresh = await getVaultSecret(supabase, c.access_token_secret_id);
  const { access_token, refresh_token: newRefresh, expires_in } =
    await refreshAccessToken({ clientKey, clientSecret, refreshToken: oldRefresh });
  await setVaultSecret(supabase, {
    existingId: c.access_token_secret_id,
    secretValue: newRefresh,
    // secretName is required by the RPC but ignored on update — keep
    // consistent with the callback's naming convention so manual
    // inspection of vault.secrets stays readable.
    secretName: `tiktok_refresh_token__${(client as { id: string }).id}__${c.tiktok_open_id}`,
  });

  console.log(`\n=== ${slug} ===`);
  console.log(`TikTok: ${c.tiktok_display_name ?? "—"}  ${c.tiktok_username ? `(@${c.tiktok_username})` : ""}`);
  console.log(`open_id: ${c.tiktok_open_id}`);
  console.log(`access_token expires_in: ${expires_in}s   (refresh token rotated + saved)`);

  await probeUserInfo(access_token);
  await probeVideoList(access_token);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers — TikTok responses are wrapped in { data, error } and
// errors come back as 200 with non-"ok" error code, so we have to inspect
// both the HTTP status AND the body.error.code.

async function tiktokGet(url: string, token: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function tiktokPost(
  url: string, token: string, body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

function header(s: string) {
  console.log(`\n━━━ ${s} ${"━".repeat(Math.max(0, 60 - s.length))}`);
}

function reportFields(label: string, obj: Record<string, unknown> | undefined) {
  console.log(`\n${label}:`);
  if (!obj) { console.log("  (no body)"); return; }
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) console.log(`  ${k}: <null>`);
    else if (typeof v === "object") console.log(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
    else console.log(`  ${k}: ${String(v).slice(0, 200)}`);
  }
}

function inspectTiktokError(r: { status: number; body: unknown }): string | null {
  if (r.status !== 200) return `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`;
  const err = (r.body as { error?: { code?: string; message?: string } })?.error;
  if (err && err.code && err.code !== "ok") {
    return `code=${err.code} msg=${err.message ?? ""}`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// /v2/user/info/ — single endpoint, GET, requested fields via ?fields=
// Returns whichever of the requested fields the granted scopes allow.

async function probeUserInfo(token: string): Promise<void> {
  header("TIKTOK — /v2/user/info/ (all granted fields)");
  // Full enumerated list — basic + profile + stats. The endpoint
  // silently omits fields whose scope wasn't granted.
  const fields = [
    // user.info.basic
    "open_id", "union_id", "avatar_url", "avatar_url_100", "avatar_large_url",
    "display_name",
    // user.info.profile
    "bio_description", "profile_deep_link", "is_verified", "username",
    // user.info.stats
    "follower_count", "following_count", "likes_count", "video_count",
  ].join(",");
  const r = await tiktokGet(`${TT_OPEN}/user/info/?fields=${fields}`, token);
  const err = inspectTiktokError(r);
  if (err) { console.log(`  ❌ ${err}`); return; }
  const user = (r.body as { data?: { user?: Record<string, unknown> } })?.data?.user;
  reportFields("  data.user", user);
}

// ─────────────────────────────────────────────────────────────────────────────
// /v2/video/list/ — POST with cursor pagination. Each video object has
// inline stats: view_count, like_count, comment_count, share_count,
// plus metadata (title, cover_image_url, duration, share_url, …).
//
// This is the load-bearing endpoint for the TikTok card: one call gives
// us recent videos AND their performance numbers without per-video
// fan-out.

async function probeVideoList(token: string): Promise<void> {
  header("TIKTOK — /v2/video/list/ (recent 10, all known fields)");
  // Enumerate every field that the docs mention. The endpoint returns
  // a subset based on the granted scope; unknown fields silently drop.
  const fields = [
    "id", "title", "video_description",
    "create_time", "duration", "cover_image_url", "share_url",
    "embed_link", "embed_html",
    "view_count", "like_count", "comment_count", "share_count",
    "height", "width",
  ].join(",");
  const r = await tiktokPost(
    `${TT_OPEN}/video/list/?fields=${fields}`,
    token,
    { max_count: 10 },
  );
  const err = inspectTiktokError(r);
  if (err) { console.log(`  ❌ ${err}`); return; }

  const body = r.body as {
    data?: {
      videos?: Array<Record<string, unknown>>;
      cursor?: number;
      has_more?: boolean;
    };
  };
  const videos = body.data?.videos ?? [];
  console.log(`  count: ${videos.length}`);
  console.log(`  has_more: ${body.data?.has_more}`);
  console.log(`  cursor: ${body.data?.cursor}`);

  if (videos[0]) {
    reportFields("  first video", videos[0]);
  }

  // Roll-up across the returned page so we can sanity check.
  if (videos.length > 0) {
    const sum = (k: string) => videos.reduce((a, v) => a + Number(v[k] ?? 0), 0);
    console.log(`\n  page totals (n=${videos.length}):`);
    for (const k of ["view_count", "like_count", "comment_count", "share_count"]) {
      console.log(`    Σ ${k.padEnd(16)} ${sum(k).toLocaleString("en-US")}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
