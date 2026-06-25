"use client";

/**
 * Self-healing social thumbnail.
 *
 * Renders a post's stored thumbnail, but when that <img> fails to load — the
 * common case for Facebook/Instagram/TikTok, whose signed CDN urls expire after
 * a few weeks, and for YouTube `maxresdefault.jpg` which 404s on many Shorts — it
 * asks the server for a fresh url once (refreshSocialThumbnail re-fetches from the
 * platform and persists the repair), then retries.
 *
 * The refresh can come back three ways:
 *   - a fresh url   → swap to it.
 *   - `{ gone }`    → the post was DELETED or made PRIVATE on its platform, so it
 *                     should not be shown at all: call `onUnavailable` (the parent
 *                     drops it from the list) and meanwhile render the placeholder.
 *   - null          → couldn't refresh but not confirmed gone → branded placeholder.
 *
 * Either way the browser's broken-image glyph is never shown.
 *
 * `itemId` is the encoded `${platform}:${postId}` id the read layer builds.
 * `clientId` omitted ⇒ no refresh (a failed load goes straight to placeholder).
 */
import { useState, type ReactNode } from "react";
import { refreshSocialThumbnail } from "@/components/social-media-actions";

type Phase = "show" | "refreshing" | "failed";

export function SocialThumb({
  clientId,
  itemId,
  thumbnailUrl,
  alt = "",
  imgClassName,
  placeholder,
  onUnavailable,
}: {
  clientId?: string;
  itemId: string;
  thumbnailUrl: string | null;
  alt?: string;
  imgClassName?: string;
  /** Branded stand-in shown while refreshing and when no thumbnail is recoverable. */
  placeholder: ReactNode;
  /** Called when the platform reports the post deleted/private — the parent
   *  should remove it from the view entirely. */
  onUnavailable?: () => void;
}) {
  const [src, setSrc] = useState<string | null>(thumbnailUrl);
  const [phase, setPhase] = useState<Phase>(thumbnailUrl ? "show" : "failed");
  const [retried, setRetried] = useState(false);

  const handleError = () => {
    // First failure with a known client → try one server-side refresh. While it
    // runs we render the placeholder (not the broken <img>), so there's no glyph
    // flash. A second failure (or no client) → placeholder for good.
    if (!retried && clientId) {
      setRetried(true);
      setPhase("refreshing");
      refreshSocialThumbnail(clientId, itemId)
        .then((res) => {
          if (res && "url" in res) {
            setSrc(res.url);
            setPhase("show");
          } else {
            // gone (deleted/private) → ask the parent to drop it; null → just a
            // placeholder. Either way this instance shows the placeholder.
            setPhase("failed");
            if (res && "gone" in res) onUnavailable?.();
          }
        })
        .catch(() => setPhase("failed"));
    } else {
      setPhase("failed");
    }
  };

  if (phase !== "show" || !src) return <>{placeholder}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote social CDN thumbnails (arbitrary domains)
    <img src={src} alt={alt} className={imgClassName} onError={handleError} />
  );
}
