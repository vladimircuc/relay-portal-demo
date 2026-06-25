"use server";

/**
 * On-demand fetch of a directly-playable MP4 url for an Instagram video/reel.
 *
 * Why this exists: the post-detail modals play IG video via the `${permalink}/embed`
 * iframe, but IG embeddability is PER-CONTENT — for reels with licensed/trending
 * audio (or embedding disabled) IG serves its branded "the link to this photo or
 * video may be broken" page instead of the player. So some reels play inline and
 * others don't, with identical markup (Varble's play, St. Louis's didn't).
 *
 * The Graph API's `media_url` on a VIDEO/REELS media is the actual signed MP4,
 * which a native <video> plays regardless of embeddability. We fetch it ON DEMAND
 * (per play click) rather than storing it because IG's signed CDN urls expire —
 * on-demand is always live, and needs no schema/migration. The iframe stays as
 * the fallback, so a fetch miss is never worse than today's behavior.
 *
 * Auth: gated by requireClientAccess (same gate as the connect/disconnect flow).
 * The stored Page token is decrypted in-process and NEVER returned to the client —
 * only the resulting public CDN url is. This mirrors the live snapshot path
 * (lib/meta-data.ts), which already decrypts the token to call Graph directly.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "@/lib/etl/vault";
import { requireClientAccess } from "@/lib/auth";
import { META_API_VERSION } from "@/lib/meta-oauth";
import type { SocialPlatform } from "@/lib/etl/social";

const G = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Resolve the playable MP4 url for one Instagram media, or null if unavailable
 * (caller falls back to the iframe embed). `mediaId` is the bare IG media id
 * (the caller strips the `meta_instagram:` prefix off the encoded item id).
 */
export async function fetchInstagramVideoUrl(
  clientId: string,
  mediaId: string,
): Promise<string | null> {
  if (!clientId || !mediaId) return null;
  // IG media ids are numeric; reject anything else so a malformed id can't be
  // templated into the Graph path (defense-in-depth — the token is in the url).
  if (!/^\d+$/.test(mediaId)) return null;

  // Throws (→ caller's .catch → iframe fallback) unless the viewer can access
  // this client. Never returns another tenant's media.
  await requireClientAccess(clientId);

  const supabase = createAdminClient();
  const { data: cred } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id")
    .eq("client_id", clientId)
    .eq("platform", "meta")
    .maybeSingle();
  const secretId = (cred as { access_token_secret_id: string | null } | null)?.access_token_secret_id;
  if (!secretId) return null;

  let token: string;
  try {
    token = await getVaultSecret(supabase, secretId);
  } catch {
    return null; // vault miss → no playback, fall back to the iframe
  }

  try {
    const res = await fetch(
      `${G}/${mediaId}?fields=media_type,media_product_type,media_url&access_token=${token}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      media_type?: string;
      media_product_type?: string;
      media_url?: string;
    };
    // media_url is the MP4 only for VIDEO / REELS; for IMAGE/CAROUSEL it's a
    // still, which we must not hand to a <video> tag.
    const isVideo = body.media_type === "VIDEO" || body.media_product_type === "REELS";
    return isVideo && body.media_url ? body.media_url : null;
  } catch {
    return null; // network/Graph error → iframe fallback
  }
}

/** Outcome of a thumbnail refresh:
 *   - `{ url }`   → a fresh, loadable thumbnail (also persisted to social_posts).
 *   - `{ gone }`  → the platform reports the post deleted/private/inaccessible,
 *                   so the caller should REMOVE it from the view entirely.
 *   - `null`      → couldn't refresh but not confirmed gone (transient error,
 *                   alive-but-no-still, unsupported platform) → keep a placeholder.
 */
export type ThumbnailRefresh = { url: string } | { gone: true } | null;

/**
 * Resolve a FRESH thumbnail for one stored post, OR report it as gone.
 *
 * Two jobs, both on demand (lazily, only when an <img> actually fails):
 *
 * 1. REPAIR an expired link. Facebook/Instagram/TikTok thumbnail urls are SIGNED
 *    and TIME-LIMITED and lapse in ~weeks; the nightly cron only re-pulls the
 *    most-recent posts, so older posts surfaced by "Top performing content" keep
 *    stale urls that 403 → broken image. We re-fetch a live url:
 *      - Facebook  → Graph `full_picture`.
 *      - Instagram → Graph `thumbnail_url` (reels/videos) | `media_url` (photos).
 *      - YouTube   → the always-present `hqdefault` still.
 *      - TikTok    → oEmbed `thumbnail_url` (fresh cover).
 *
 * 2. DETECT a post that's been DELETED or made PRIVATE on its platform. When that
 *    happens there's no thumbnail and it can't be opened, so it should not appear
 *    at all. Each platform gives a distinct "gone" signal:
 *      - Facebook/Instagram → Graph error code 100 (object missing / no access).
 *      - YouTube            → the thumbnail 404/403s (no still exists anymore).
 *      - TikTok             → oEmbed non-200 for the video url.
 *    We return `{ gone: true }` and the UI removes the card/row. We DON'T persist
 *    "gone" (no schema column), so it's re-checked each load — cheap, since
 *    deleted posts are rare, and a false positive self-corrects next render.
 *
 * Auth + token handling mirror fetchInstagramVideoUrl: gated by
 * requireClientAccess, the token is decrypted in-process and NEVER returned —
 * only the resulting public url is.
 */
export async function refreshSocialThumbnail(
  clientId: string,
  itemId: string,
): Promise<ThumbnailRefresh> {
  if (!clientId || !itemId) return null;
  const sep = itemId.indexOf(":");
  if (sep < 0) return null;
  const platform = itemId.slice(0, sep) as SocialPlatform;
  const postId = itemId.slice(sep + 1);
  if (!postId) return null;

  // Throws (→ caller's .catch → placeholder) unless the viewer can access this
  // client. Never refreshes another tenant's media.
  await requireClientAccess(clientId);

  const supabase = createAdminClient();

  let result: ThumbnailRefresh = null;
  if (platform === "youtube") {
    result = await refreshYoutubeThumbnail(postId);
  } else if (platform === "meta_facebook" || platform === "meta_instagram") {
    result = await refreshMetaThumbnail(supabase, clientId, platform, postId);
  } else if (platform === "tiktok") {
    result = await refreshTiktokThumbnail(supabase, clientId, postId);
  }
  // linkedin: no fetch path → null.

  // Persist a fresh url so later loads use it directly (until it expires again).
  // Best-effort; a write miss just means we refresh again next time. We do NOT
  // persist "gone" (no column for it) — it's recomputed each load.
  if (result && "url" in result) {
    await supabase
      .from("social_posts")
      .update({ thumbnail_url: result.url })
      .eq("client_id", clientId)
      .eq("platform", platform)
      .eq("post_id", postId);
  }

  return result;
}

/** YouTube: hqdefault exists for every live video; a 404/403 means the video is
 *  deleted/private (no still served) → gone. No token needed. */
async function refreshYoutubeThumbnail(postId: string): Promise<ThumbnailRefresh> {
  // Video ids are [A-Za-z0-9_-]; reject anything else so we never build a garbage url.
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(postId)) return null;
  const url = `https://i.ytimg.com/vi/${postId}/hqdefault.jpg`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) return { url };
    if (res.status === 404 || res.status === 403 || res.status === 410) return { gone: true };
    return null; // 5xx/other → transient
  } catch {
    return null;
  }
}

/** Re-fetch a fresh Facebook/Instagram thumbnail via Graph, or detect deletion.
 *  Graph error code 100 = object doesn't exist / no longer accessible → gone. */
async function refreshMetaThumbnail(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string,
  platform: "meta_facebook" | "meta_instagram",
  postId: string,
): Promise<ThumbnailRefresh> {
  // Defense-in-depth on the id templated into a token-bearing url: FB post ids
  // are `pageid_postid`, IG media ids are numeric.
  const idOk =
    platform === "meta_facebook" ? /^\d+_\d+$/.test(postId) : /^\d+$/.test(postId);
  if (!idOk) return null;

  const { data: cred } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id")
    .eq("client_id", clientId)
    .eq("platform", "meta")
    .maybeSingle();
  const secretId = (cred as { access_token_secret_id: string | null } | null)?.access_token_secret_id;
  if (!secretId) return null;

  let token: string;
  try {
    token = await getVaultSecret(supabase, secretId);
  } catch {
    return null;
  }

  try {
    const fields =
      platform === "meta_facebook"
        ? "full_picture"
        : "thumbnail_url,media_url,media_type,media_product_type";
    const res = await fetch(`${G}/${postId}?fields=${fields}&access_token=${token}`, {
      cache: "no-store",
    });
    const body = (await res.json()) as {
      full_picture?: string;
      thumbnail_url?: string;
      media_url?: string;
      media_type?: string;
      media_product_type?: string;
      error?: { code?: number };
    };
    if (body.error) {
      // 100 = "Object with ID does not exist / cannot be loaded due to missing
      // permissions" — i.e. deleted or made private since we stored it (we read
      // it fine before with THIS token). Auth/throttle codes (190 token expired,
      // 4/17/32 rate limits, 2 transient) are NOT per-post deletion → keep it.
      return body.error.code === 100 ? { gone: true } : null;
    }
    if (platform === "meta_facebook") return body.full_picture ? { url: body.full_picture } : null;
    // IG: thumbnail_url is the still for reels/videos; for photos/carousels it's
    // absent and media_url is the image. But on a VIDEO/REEL media_url is the raw
    // MP4 — never usable as an <img> src — so only fall back to it when this is
    // NOT a video (mirrors fetchInstagramVideoUrl's media_type/product_type check).
    const isVideo = body.media_type === "VIDEO" || body.media_product_type === "REELS";
    const url = body.thumbnail_url || (isVideo ? undefined : body.media_url);
    return url ? { url } : null;
  } catch {
    return null;
  }
}

/** TikTok: oEmbed on the stored permalink returns a fresh cover `thumbnail_url`
 *  for a live video, and a non-200 (400/404) once it's deleted/private → gone.
 *  No token needed (public oEmbed). */
async function refreshTiktokThumbnail(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string,
  postId: string,
): Promise<ThumbnailRefresh> {
  if (!/^\d+$/.test(postId)) return null;
  // oEmbed needs the full video url (it carries the @handle), which we stored.
  const { data } = await supabase
    .from("social_posts")
    .select("permalink")
    .eq("client_id", clientId)
    .eq("platform", "tiktok")
    .eq("post_id", postId)
    .maybeSingle();
  const permalink = (data as { permalink: string | null } | null)?.permalink;
  if (!permalink || !/^https:\/\/(www\.)?tiktok\.com\//.test(permalink)) return null;
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(permalink)}`, {
      cache: "no-store",
    });
    if (res.status === 400 || res.status === 404) return { gone: true };
    if (!res.ok) return null; // transient
    const body = (await res.json()) as { thumbnail_url?: string };
    return body.thumbnail_url ? { url: body.thumbnail_url } : null;
  } catch {
    return null;
  }
}
