/**
 * Server-side TikTok data fetcher for the admin "Account snapshot" panel.
 *
 * Single entry point — `fetchTiktokSnapshot()` — that, given a client_id:
 *   1. Loads the stored refresh_token from Vault
 *   2. Mints a fresh access_token (TikTok rotates the refresh token on
 *      every call, so we persist the new one back to Vault)
 *   3. Calls /v2/user/info/ for headline account stats
 *   4. Calls /v2/video/list/ for the 6 most-recent public videos
 *   5. Returns a typed payload the React component can render directly
 *
 * Why this lives separately from the ETL ETL (lib/etl/*) — this fetcher
 * is intentionally LIVE-only. The admin snapshot is a real-time view
 * intended for the OAuth-review demo + agency-operator verification.
 * The eventual ETL will run on cron, snapshot into tables, and the
 * dashboard cards will read from those tables. For now, while the data
 * model isn't built, hitting the API live keeps the snapshot honest
 * without prematurely committing to a schema.
 *
 * Failure mode: if anything throws (revoked token, TikTok 5xx, rate
 * limit) the function returns `{ ok: false, error: "..." }`. Callers
 * are server components — they handle the error inline rather than
 * crashing the admin page.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret, setVaultSecret } from "@/lib/etl/vault";
import { refreshAccessToken } from "@/lib/tiktok-oauth";

const TT = "https://open.tiktokapis.com/v2";

export type TiktokSnapshot = {
  ok: true;
  user: {
    open_id: string;
    display_name: string;
    username: string | null;
    bio_description: string | null;
    avatar_url: string | null;
    profile_deep_link: string | null;
    is_verified: boolean;
    follower_count: number;
    following_count: number;
    likes_count: number;
    video_count: number;
  };
  videos: Array<{
    id: string;
    title: string;
    create_time: number;       // unix seconds
    duration: number;          // seconds
    cover_image_url: string;
    share_url: string;
    embed_link: string;
    view_count: number;
    like_count: number;
    comment_count: number;
    share_count: number;
  }>;
};

export type TiktokSnapshotResult = TiktokSnapshot | { ok: false; error: string };

export async function fetchTiktokSnapshot(args: {
  clientId: string;
}): Promise<TiktokSnapshotResult> {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    return { ok: false, error: "TikTok client key/secret not configured." };
  }

  try {
    const supabase = createAdminClient();

    const { data: creds } = await supabase
      .from("client_social_credentials")
      .select("access_token_secret_id, tiktok_open_id, tiktok_username, tiktok_display_name, tiktok_avatar_url")
      .eq("client_id", args.clientId)
      .eq("platform", "tiktok")
      .maybeSingle();

    if (!creds) {
      return { ok: false, error: "No TikTok credential row for this client." };
    }
    const c = creds as {
      access_token_secret_id: string;
      tiktok_open_id: string;
      tiktok_username: string | null;
      tiktok_display_name: string | null;
      tiktok_avatar_url: string | null;
    };

    // 1. Pull the stored refresh token from Vault.
    const oldRefresh = await getVaultSecret(supabase, c.access_token_secret_id);

    // 2. Trade it for a fresh access_token. TikTok ALSO rotates the
    //    refresh token on this call, so we persist the new one back.
    const refreshed = await refreshAccessToken({
      clientKey, clientSecret, refreshToken: oldRefresh,
    });
    await setVaultSecret(supabase, {
      existingId: c.access_token_secret_id,
      secretValue: refreshed.refresh_token,
      secretName: `tiktok_refresh_token__${args.clientId}__${c.tiktok_open_id}`,
    });
    const token = refreshed.access_token;

    // 3. Account-level info — display name, avatar, follower/video counts.
    const userInfo = await fetchUserInfo(token);
    if (!userInfo.ok) return { ok: false, error: userInfo.error };

    // 4. Recent 6 videos — each item includes inline per-video stats so
    //    we don't need a per-video fan-out call.
    const videos = await fetchRecentVideos(token, 6);
    if (!videos.ok) return { ok: false, error: videos.error };

    return {
      ok: true,
      user: userInfo.user,
      videos: videos.videos,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "TikTok snapshot failed." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner fetchers — separated for testability and so each error path is
// distinguishable in logs.

async function fetchUserInfo(
  token: string,
): Promise<{ ok: true; user: TiktokSnapshot["user"] } | { ok: false; error: string }> {
  const fields = [
    "open_id", "union_id",
    "avatar_url", "avatar_url_100", "avatar_large_url",
    "display_name", "username",
    "bio_description", "profile_deep_link", "is_verified",
    "follower_count", "following_count", "likes_count", "video_count",
  ].join(",");
  const res = await fetch(`${TT}/user/info/?fields=${fields}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { user?: Partial<TiktokSnapshot["user"]> };
    error?: { code?: string; message?: string };
  };
  if (res.status !== 200 || (body.error && body.error.code && body.error.code !== "ok")) {
    return {
      ok: false,
      error: `user/info ${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.trim(),
    };
  }
  const u = body.data?.user;
  if (!u || !u.open_id) {
    return { ok: false, error: "user/info returned no user object." };
  }
  return {
    ok: true,
    user: {
      open_id: u.open_id,
      display_name: u.display_name ?? "",
      username: u.username ?? null,
      bio_description: u.bio_description ?? null,
      avatar_url: u.avatar_url ?? null,
      profile_deep_link: u.profile_deep_link ?? null,
      is_verified: u.is_verified ?? false,
      follower_count: Number(u.follower_count ?? 0),
      following_count: Number(u.following_count ?? 0),
      likes_count: Number(u.likes_count ?? 0),
      video_count: Number(u.video_count ?? 0),
    },
  };
}

async function fetchRecentVideos(
  token: string, maxCount: number,
): Promise<{ ok: true; videos: TiktokSnapshot["videos"] } | { ok: false; error: string }> {
  const fields = [
    "id", "title",
    "create_time", "duration",
    "cover_image_url", "share_url", "embed_link",
    "view_count", "like_count", "comment_count", "share_count",
  ].join(",");
  const res = await fetch(`${TT}/video/list/?fields=${fields}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ max_count: Math.max(1, Math.min(20, maxCount)) }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { videos?: Array<Record<string, unknown>>; cursor?: number; has_more?: boolean };
    error?: { code?: string; message?: string };
  };
  if (res.status !== 200 || (body.error && body.error.code && body.error.code !== "ok")) {
    return {
      ok: false,
      error: `video/list ${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.trim(),
    };
  }
  const list = body.data?.videos ?? [];
  return {
    ok: true,
    videos: list.map((v) => ({
      id: String(v.id ?? ""),
      title: String(v.title ?? ""),
      create_time: Number(v.create_time ?? 0),
      duration: Number(v.duration ?? 0),
      cover_image_url: String(v.cover_image_url ?? ""),
      share_url: String(v.share_url ?? ""),
      embed_link: String(v.embed_link ?? ""),
      view_count: Number(v.view_count ?? 0),
      like_count: Number(v.like_count ?? 0),
      comment_count: Number(v.comment_count ?? 0),
      share_count: Number(v.share_count ?? 0),
    })),
  };
}
