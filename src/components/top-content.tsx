"use client";

/**
 * Top performing content — the best organic posts in the selected range,
 * rendered as rich post cards and ranked by Impressions or Engagements.
 *
 * Clicking a card opens a detail modal (bigger media + full caption + the full
 * metric breakdown + a link to the original post).
 *
 * Data shape (`TopContentItem`) mirrors the per-post fields the platform
 * snapshot fetchers already return (Meta posts / IG media / YouTube + TikTok
 * videos: permalink, thumbnail, caption, reach metric, reactions/likes,
 * comments, shares). Fed live from fetchTopContent() on the /socials page.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  Eye, Play, Zap, Heart, MessageCircle, Share2, Images, Film, Clapperboard,
  Maximize2, ExternalLink, X, HelpCircle, Info, Percent, Users, type LucideIcon,
} from "lucide-react";
import type { SocialPlatform } from "@/lib/etl/social";
import { Segmented } from "@/components/ui/segmented";
import { fetchInstagramVideoUrl } from "@/components/social-media-actions";
import { SocialThumb } from "@/components/social-thumb";

// ─────────────────────────────────────────────────────────────────────────────
// Data contract

export type ContentMediaType = "image" | "video" | "reel" | "carousel" | "text";
/** What the headline reach number means for this post. "views" (repeat-inclusive,
 *  on-screen) is now the cross-platform standard every platform reports and is the
 *  default; "reach" (unique accounts) is the fallback for legacy IG media that
 *  predates the Views metric. "impressions"/"plays" are retained only so old rows
 *  written before the Views switch still render until a re-backfill relabels them.
 *  "unknown" is the honest fallback for legacy rows that stored no kind at all — we
 *  surface the generic "Views" label rather than asserting a metric we don't have. */
export type ReachKind = "impressions" | "plays" | "views" | "reach" | "unknown";

export type TopContentItem = {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  /** ISO date — "yyyy-MM-dd" or a full ISO timestamp. */
  postedAt: string;
  /** Link to the original post (opened from the detail modal). */
  permalink: string;
  thumbnailUrl: string | null;
  mediaType: ContentMediaType;
  caption: string;
  /** Headline reach metric + which kind it is (drives the footer label). */
  reach: { kind: ReachKind; value: number };
  engagements: number;
  /** Engagement parts — platform-dependent, omitted when not reported. For
   *  Facebook, `likes` is the total reaction count. */
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
};

export type TopContentSort = "impressions" | "engagements";

// ─────────────────────────────────────────────────────────────────────────────
// Brand + metric metadata (kept local so this section is self-contained)

const PLATFORM_META: Record<SocialPlatform, { label: string; color: string; logo: string }> = {
  meta_facebook:  { label: "Facebook",  color: "#1877F2", logo: "/brand/social/facebook.png" },
  meta_instagram: { label: "Instagram", color: "#E1306C", logo: "/brand/social/instagram.png" },
  youtube:        { label: "YouTube",   color: "#FF4D4F", logo: "/brand/social/youtube.png" },
  tiktok:         { label: "TikTok",    color: "#25F4EE", logo: "/brand/social/tiktok.png" },
  linkedin:       { label: "LinkedIn",  color: "#0A66C2", logo: "/brand/social/linkedin.png" },
};

const REACH_META: Record<ReachKind, { icon: LucideIcon; label: string }> = {
  impressions: { icon: Eye,   label: "Impressions" },
  plays:       { icon: Play,  label: "Plays" },
  views:       { icon: Play,  label: "Views" },
  reach:       { icon: Users, label: "Reach" },
  // Legacy rows with no stored kind: show the neutral generic axis label
  // ("Views") instead of claiming a specific metric we never recorded.
  unknown:     { icon: Eye,   label: "Views" },
};

const MEDIA_BADGE: Partial<Record<ContentMediaType, { icon: LucideIcon; label: string }>> = {
  video:    { icon: Film,        label: "Video" },
  reel:     { icon: Clapperboard, label: "Reel" },
  carousel: { icon: Images,      label: "Carousel" },
};

const SORT_TIP: Record<TopContentSort, string> = {
  impressions: "Content published in the selected date range, ranked by how many times it was seen (views, plays, or impressions).",
  engagements: "Content published in the selected date range, ranked by total engagements — reactions, likes, comments, and shares.",
};

/** Toggle button labels. The reach sort key stays "impressions" internally, but
 *  most platforms now report a repeat-inclusive "Views" metric, so we surface
 *  the toggle as Views (per-card footers still show each post's own kind). */
const SORT_LABEL: Record<TopContentSort, string> = {
  impressions: "Views",
  engagements: "Engagements",
};

// ─────────────────────────────────────────────────────────────────────────────
// Formatters

const fmtCompact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
  : Math.abs(n) >= 1_000 ? (n / 1_000).toFixed(1) + "K"
  : String(n);
const fmtFull = (n: number) => n.toLocaleString("en-US");

function parsePostDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(iso);
}
const fmtPostDate = (iso: string) =>
  parsePostDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtPostDateLong = (iso: string) =>
  parsePostDate(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// ─────────────────────────────────────────────────────────────────────────────
// Small shared pieces

function Logo({ platform, size = 22 }: { platform: SocialPlatform; size?: number }) {
  const m = PLATFORM_META[platform];
  return (
    <span className="inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <Image src={m.logo} alt={m.label} width={size} height={size} className="object-contain" style={{ width: size, height: size }} />
    </span>
  );
}

/** Branded gradient stand-in when a post has no thumbnail. */
function MediaPlaceholder({ platform }: { platform: SocialPlatform }) {
  const meta = PLATFORM_META[platform];
  return (
    <span aria-hidden className="absolute inset-0 flex items-center justify-center"
      style={{ background: `linear-gradient(135deg, ${meta.color}26, var(--surface-3))` }}>
      <span className="opacity-30"><Logo platform={platform} size={48} /></span>
    </span>
  );
}

/** Header help chip — morphs from "?" to an "i" on hover and reveals a tooltip
 *  explaining the current ranking (same affordance as the metric tiles). */
function InfoChip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span
        className={"relative inline-flex items-center justify-center h-6 w-6 rounded-lg cursor-help text-[var(--accent-fg)] transition-colors duration-200 " +
          (open ? "bg-[var(--surface-3)]" : "bg-[var(--surface-3)]/45")}
        aria-label={text}
      >
        {/* "?" → "i" morph + tooltip are desktop-only (touch would flip it to
            "i" with the tooltip off-screen). */}
        <span aria-hidden className={"absolute inset-0 flex items-center justify-center transition-all duration-200 " + (open ? "md:opacity-0 md:scale-50 md:rotate-90" : "opacity-100 scale-100 rotate-0")}>
          <HelpCircle size={14} strokeWidth={2.25} />
        </span>
        <span aria-hidden className={"absolute inset-0 flex items-center justify-center transition-all duration-200 " + (open ? "opacity-0 md:opacity-100 md:scale-100 md:rotate-0" : "opacity-0 scale-50 -rotate-90")}>
          <Info size={14} strokeWidth={2.5} />
        </span>
      </span>
      {open && (
        <span className="hidden md:block absolute left-0 top-full z-30 w-64 pt-2">
          <span className="block p-2.5 rounded-md bg-[var(--surface-0)] border border-[var(--surface-3)] shadow-xl">
            <span className="block text-[11px] text-[var(--text-secondary)] leading-snug">{text}</span>
          </span>
        </span>
      )}
    </span>
  );
}

/** likes / comments / shares present on an item, in display order. */
function engParts(item: TopContentItem): Array<{ icon: LucideIcon; value: number }> {
  const out: Array<{ icon: LucideIcon; value: number }> = [];
  if (item.likes != null) out.push({ icon: Heart, value: item.likes });
  if (item.comments != null) out.push({ icon: MessageCircle, value: item.comments });
  if (item.shares != null) out.push({ icon: Share2, value: item.shares });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Post card

function FooterStat({ icon: Icon, label, value, active, color }: {
  icon: LucideIcon; label: string; value: string; active: boolean; color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] font-medium transition-colors"
        style={{ color: active ? color : "var(--text-tertiary)" }}>
        <Icon size={13} strokeWidth={2.25} /> {label}
      </span>
      <span className="text-[15px] font-bold tabular-nums" style={{ color: active ? color : "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function PostCard({ item, rank, sort, onOpen, clientId, onUnavailable }: {
  item: TopContentItem; rank: number; sort: TopContentSort; onOpen: () => void;
  /** Enables self-healing thumbnail refresh on a dead/expired CDN url. */
  clientId?: string;
  /** Called when the post is detected deleted/private → drop it from the ranking. */
  onUnavailable?: () => void;
}) {
  const meta = PLATFORM_META[item.platform];
  const reachMeta = REACH_META[item.reach.kind];
  const badge = MEDIA_BADGE[item.mediaType];
  const parts = engParts(item);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative text-left rounded-xl border border-[var(--surface-3)]/40 bg-[var(--surface-2)]/30 overflow-hidden flex flex-col transition-all duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:border-[var(--surface-3)] hover:shadow-xl hover:shadow-black/30"
    >
      {/* brand sheen on hover */}
      <span aria-hidden className="pointer-events-none absolute inset-0 z-10 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(120% 70% at 50% 0%, ${meta.color}14, transparent 60%)` }} />

      {/* header */}
      <div className="relative z-20 flex items-center gap-2 px-3.5 pt-3.5 pb-2.5">
        <Logo platform={item.platform} size={20} />
        <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{item.accountName}</span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--text-tertiary)]">{fmtPostDate(item.postedAt)}</span>
      </div>

      {/* media */}
      <div className="relative mx-3.5 overflow-hidden rounded-lg aspect-[16/10] bg-[var(--surface-3)]/40">
        <SocialThumb
          clientId={clientId}
          itemId={item.id}
          thumbnailUrl={item.thumbnailUrl}
          imgClassName="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
          placeholder={<MediaPlaceholder platform={item.platform} />}
          onUnavailable={onUnavailable}
        />
        {/* legibility scrim for the badges */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/45 to-transparent" />
        {/* rank — brand pill, top-left */}
        <span className="absolute left-2 top-2 inline-flex items-center h-6 px-2 rounded-full text-[11px] font-bold text-white backdrop-blur-sm" style={{ background: `${meta.color}e6` }}>#{rank}</span>
        {/* media type — top-right */}
        {badge && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/55 backdrop-blur-sm text-[10.5px] font-semibold text-white">
            <badge.icon size={12} strokeWidth={2.25} /> {badge.label}
          </span>
        )}
        {/* expand affordance — appears on hover, bottom-right */}
        <span aria-hidden className="absolute right-2 bottom-2 inline-flex items-center justify-center h-7 w-7 rounded-full bg-black/55 text-white backdrop-blur-sm opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0">
          <Maximize2 size={13} strokeWidth={2.25} />
        </span>
      </div>

      {/* caption — fixed two-line box (block wrapper holds the height reliably;
          the clamped <p> alone won't reserve space for a one-line caption) so
          every card's strip + footer line up regardless of caption length */}
      <div className="relative z-20 px-3.5 pt-3">
        <div className="h-10 overflow-hidden">
          <p className="line-clamp-2 text-[13px] leading-snug text-[var(--text-primary)]">{item.caption}</p>
        </div>
      </div>

      {/* engagement parts */}
      {parts.length > 0 && (
        <div className="relative z-20 flex items-center gap-3.5 px-3.5 pt-2.5 text-[12px] text-[var(--text-secondary)]">
          {parts.map((p, idx) => (
            <span key={idx} className="inline-flex items-center gap-1">
              <p.icon size={13} strokeWidth={2.25} style={{ color: meta.color }} />
              <span className="tabular-nums">{fmtCompact(p.value)}</span>
            </span>
          ))}
        </div>
      )}

      {/* divider + footer pinned to the card bottom so every card's stats line up */}
      <div className="relative z-20 mt-auto">
        <div className="mx-3.5 mt-3 border-t border-[var(--surface-3)]/40" />
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          <FooterStat icon={reachMeta.icon} label={reachMeta.label} value={fmtCompact(item.reach.value)} active={sort === "impressions"} color={meta.color} />
          <FooterStat icon={Zap} label="Engagements" value={fmtCompact(item.engagements)} active={sort === "engagements"} color={meta.color} />
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail modal

/** Public embed URL for a post's video, or null if it isn't inline-playable.
 *  Built entirely from data we already store (post id + permalink) — no extra
 *  API calls or tokens. Facebook/LinkedIn are intentionally omitted (their
 *  embeds are unreliable). `layout` drives the iframe box: YouTube is 16:9,
 *  vertical players (TikTok / IG reels) get a tall, width-capped box. */
/** Minimal item shape needed to build an embed URL — shared with ContentLibrary
 *  so both render identical inline players from one source of truth. */
export type EmbeddableItem = Pick<TopContentItem, "id" | "platform" | "mediaType" | "permalink">;

export function videoEmbed(item: EmbeddableItem): { url: string; layout: "wide" | "tall" } | null {
  if (item.mediaType !== "video" && item.mediaType !== "reel") return null;
  // fetchTopContent encodes id as `${platform}:${post_id}`; the embed URLs need
  // the bare native video id, so strip the platform prefix when present.
  const prefix = `${item.platform}:`;
  const postId = item.id.startsWith(prefix) ? item.id.slice(prefix.length) : item.id;
  switch (item.platform) {
    case "youtube":
      return postId ? { url: `https://www.youtube.com/embed/${postId}?rel=0&autoplay=1`, layout: "wide" } : null;
    case "tiktok":
      // /player/v1 is TikTok's actual video player (plays inline); /embed/v2 is
      // only a preview card with a dead play button.
      return postId ? { url: `https://www.tiktok.com/player/v1/${postId}?autoplay=1&controls=1`, layout: "tall" } : null;
    case "meta_instagram": {
      const base = item.permalink.replace(/\/+$/, "");
      return /instagram\.com\//.test(base) ? { url: `${base}/embed`, layout: "tall" } : null;
    }
    case "meta_facebook": {
      // Experimental: FB's video plugin only renders for an actual video URL —
      // a plain post permalink may show a blank/oversized box. Trial only.
      if (!/facebook\.com\//.test(item.permalink)) return null;
      const href = encodeURIComponent(item.permalink);
      return { url: `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false`, layout: "wide" };
    }
    default:
      return null;
  }
}

function MetricCell({ icon: Icon, label, value, color }: {
  icon: LucideIcon; label: string; value: string; color?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--surface-3)]/50 bg-[var(--surface-2)]/40 px-3 py-2.5 flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.08em] font-medium text-[var(--text-tertiary)]">
        <Icon size={13} strokeWidth={2.25} style={color ? { color } : undefined} /> {label}
      </span>
      <span className="text-[18px] font-bold tabular-nums text-[var(--text-primary)] leading-none">{value}</span>
    </div>
  );
}

/** Engagement rate → a label that never collapses a real, non-zero rate to
 *  "0.0%": sub-0.1% renders "<0.1%", ≥10% drops the decimal. */
export function fmtEngRate(pct: number): string {
  if (pct <= 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  return `${pct.toFixed(pct >= 10 ? 0 : 1)}%`;
}

/** The full per-post metric grid shown in detail modals (Top Content + Content
 *  library). Reach kind drives the first tile's icon/label. Eng. rate is the
 *  industry-standard per-post rate = engagements ÷ reach (i.e. ÷ views for
 *  video/TikTok, ÷ impressions for feed) — the audience the post actually
 *  reached, so a viral low-follower post reads as a healthy single-digit %
 *  rather than the 117% a ÷-followers rate produces. Hidden when reach is
 *  unknown (0). Cells with null parts are omitted. Shared so both modals match. */
export function PostStatGrid({
  platform, reach, engagements, likes, comments, shares,
}: {
  platform: SocialPlatform;
  reach: { kind: ReachKind; value: number };
  engagements: number;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
}) {
  const meta = PLATFORM_META[platform];
  const reachMeta = REACH_META[reach.kind];
  const engRatePct = reach.value > 0 ? (engagements / reach.value) * 100 : null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
      <MetricCell icon={reachMeta.icon} label={reachMeta.label} value={fmtFull(reach.value)} color={meta.color} />
      <MetricCell icon={Zap} label="Engagements" value={fmtFull(engagements)} color={meta.color} />
      {engRatePct != null && <MetricCell icon={Percent} label="Eng. rate" value={fmtEngRate(engRatePct)} />}
      {likes != null && <MetricCell icon={Heart} label="Likes" value={fmtFull(likes)} />}
      {comments != null && <MetricCell icon={MessageCircle} label="Comments" value={fmtFull(comments)} />}
      {shares != null && <MetricCell icon={Share2} label="Shares" value={fmtFull(shares)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline media player (shared by both detail modals: PostModal + ContentModal)

/**
 * The media box inside a post-detail modal: a cover thumbnail with a play button
 * that, on click, plays the post's video inline.
 *
 * Instagram video/reels play as a NATIVE <video> from the Graph API's `media_url`
 * (a signed MP4), fetched on demand via fetchInstagramVideoUrl. Why not the
 * /embed iframe for IG: embeddability is per-content — IG renders its branded
 * "the link to this photo or video may be broken" page for reels with licensed/
 * trending audio or embedding disabled, so some reels play and some don't with
 * identical markup. The raw MP4 plays regardless. The /embed iframe stays as the
 * fallback (and remains the path for YouTube / TikTok / Facebook), so if the MP4
 * can't be fetched we're never worse off than before.
 *
 * `overlay` (rank / media-type badges) and `placeholder` (no-thumbnail stand-in)
 * are supplied per modal so each keeps its own chrome while sharing one play
 * pipeline. `clientId` omitted ⇒ IG native fetch disabled (iframe-only, the old
 * behavior) — keeps the component usable without an authenticated client.
 */
export function InlineMedia({
  platform, mediaType, thumbnailUrl, itemId, embed, layout, clientId,
  platformLabel, overlay, placeholder,
}: {
  platform: SocialPlatform;
  mediaType: ContentMediaType;
  thumbnailUrl: string | null;
  /** Encoded `${platform}:${post_id}` id — the bare media id is recovered for IG. */
  itemId: string;
  embed: { url: string; layout: "wide" | "tall" } | null;
  layout: "wide" | "tall";
  /** Enables on-demand IG MP4 fetch (omit ⇒ iframe-only). */
  clientId?: string;
  platformLabel: string;
  overlay?: ReactNode;
  placeholder: ReactNode;
}) {
  const igNative =
    platform === "meta_instagram" &&
    (mediaType === "video" || mediaType === "reel") &&
    !!clientId;

  const [playing, setPlaying] = useState(false);
  const [mp4, setMp4] = useState<string | null>(null);
  // idle → not requested; loading → fetching; ready → play <video>; failed → iframe.
  const [mp4State, setMp4State] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  const canPlay = !!embed || igNative;

  const onPlay = () => {
    setPlaying(true);
    if (igNative && mp4State === "idle") {
      setMp4State("loading");
      const prefix = `${platform}:`;
      const mediaId = itemId.startsWith(prefix) ? itemId.slice(prefix.length) : itemId;
      fetchInstagramVideoUrl(clientId!, mediaId)
        .then((url) => {
          if (url) { setMp4(url); setMp4State("ready"); }
          else setMp4State("failed");
        })
        .catch(() => setMp4State("failed"));
    }
  };

  // Player box — matches the iframe's sizing so native video and iframe look
  // identical (wide → 16:9; tall → height- and width-capped vertical box).
  const playerBox = (child: ReactNode) => (
    <div
      className={"relative w-full" + (layout === "wide" ? " aspect-video" : " mx-auto")}
      style={layout === "tall" ? { height: "min(70vh, 620px)", maxWidth: 400 } : undefined}
    >
      {child}
    </div>
  );

  // Native IG MP4 ready → inline <video> (object-contain so a landscape feed
  // video letterboxes in the tall box instead of stretching).
  if (playing && igNative && mp4State === "ready" && mp4) {
    return playerBox(
      <video
        src={mp4}
        poster={thumbnailUrl ?? undefined}
        controls
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full object-contain bg-black"
      />,
    );
  }

  // Native IG MP4 still loading → dimmed cover + spinner.
  if (playing && igNative && mp4State === "loading") {
    return (
      <>
        <SocialThumb
          clientId={clientId}
          itemId={itemId}
          thumbnailUrl={thumbnailUrl}
          imgClassName="w-full max-h-[440px] object-cover opacity-50"
          placeholder={placeholder}
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </span>
      </>
    );
  }

  // Iframe path: non-IG embeddable video, or IG whose MP4 fetch failed.
  if (playing && embed && (!igNative || mp4State === "failed")) {
    return playerBox(
      <iframe
        src={embed.url}
        title={`${platformLabel} video`}
        className="absolute inset-0 h-full w-full"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />,
    );
  }

  // Not playing → cover + play affordance + the modal's own badges.
  return (
    <>
      <SocialThumb
        clientId={clientId}
        itemId={itemId}
        thumbnailUrl={thumbnailUrl}
        imgClassName="w-full max-h-[440px] object-cover"
        placeholder={placeholder}
      />
      {canPlay && (
        <button
          type="button"
          onClick={onPlay}
          aria-label="Play video"
          className="group/play absolute inset-0 flex items-center justify-center bg-black/15 transition-colors hover:bg-black/30"
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition-transform duration-200 group-hover/play:scale-110">
            <Play size={26} strokeWidth={2.5} className="ml-1 fill-current" />
          </span>
        </button>
      )}
      {overlay}
    </>
  );
}

function PostModal({ item, rank, sort, onClose, clientId }: {
  item: TopContentItem; rank: number; sort: TopContentSort; onClose: () => void;
  /** Enables native IG reel playback in the modal (omit ⇒ iframe-only). */
  clientId?: string;
}) {
  const embed = videoEmbed(item);
  // FB videos can be portrait (reel) or landscape, and the Graph API doesn't
  // distinguish them — so measure the cover thumbnail's aspect to choose the
  // box shape, else a 16:9 box crops a vertical FB reel. Other platforms'
  // players handle their own aspect (YT letterboxes shorts; TikTok/IG portrait).
  const [thumbAspect, setThumbAspect] = useState<number | null>(null);
  useEffect(() => {
    if (item.platform !== "meta_facebook" || !item.thumbnailUrl) return;
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) setThumbAspect(img.naturalWidth / img.naturalHeight);
    };
    img.src = item.thumbnailUrl;
  }, [item.platform, item.thumbnailUrl]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const meta = PLATFORM_META[item.platform];
  const badge = MEDIA_BADGE[item.mediaType];
  // FB portrait reel → tall box; everything else keeps the embed's own layout.
  const layout: "wide" | "tall" =
    embed && item.platform === "meta_facebook" && thumbAspect !== null && thumbAspect < 1
      ? "tall"
      : embed?.layout ?? "wide";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[var(--surface-0)]/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[680px] max-h-[88vh] overflow-y-auto bg-[var(--surface-1)] border border-[var(--surface-3)]/60 rounded-[var(--radius-card)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        {/* header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--surface-3)]/40 bg-[var(--surface-1)]/95 backdrop-blur px-5 py-3.5">
          <Logo platform={item.platform} size={26} />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[var(--text-primary)] truncate">{item.accountName}</div>
            <div className="text-[11px] text-[var(--text-tertiary)]">{fmtPostDateLong(item.postedAt)} · {meta.label}</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <a href={item.permalink} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--surface-3)]/70 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] hover:border-[var(--surface-3)]">
              <ExternalLink size={13} /> View original
            </a>
            <button type="button" onClick={onClose} aria-label="Close"
              className="h-8 w-8 rounded-md flex items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* body */}
        <div className="p-5 flex flex-col gap-4">
          {/* media — click to play inline for embeddable video (YouTube /
              TikTok / Instagram reels); otherwise a static thumbnail */}
          <div className="relative overflow-hidden rounded-xl border border-[var(--surface-3)]/50 bg-black" style={{ minHeight: 220 }}>
            <InlineMedia
              platform={item.platform}
              mediaType={item.mediaType}
              thumbnailUrl={item.thumbnailUrl}
              itemId={item.id}
              embed={embed}
              layout={layout}
              clientId={clientId}
              platformLabel={meta.label}
              placeholder={<div className="relative aspect-[16/10]"><MediaPlaceholder platform={item.platform} /></div>}
              overlay={
                <>
                  <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center h-7 px-2.5 rounded-full text-[12px] font-bold text-white backdrop-blur-sm" style={{ background: `${meta.color}e6` }}>
                    #{rank} by {sort === "impressions" ? "reach" : "engagement"}
                  </span>
                  {badge && (
                    <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-black/55 backdrop-blur-sm text-[11px] font-semibold text-white">
                      <badge.icon size={13} strokeWidth={2.25} /> {badge.label}
                    </span>
                  )}
                </>
              }
            />
          </div>

          {/* caption */}
          {item.caption && (
            <p className="text-[14px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">{item.caption}</p>
          )}

          {/* full metric breakdown */}
          <PostStatGrid
            platform={item.platform}
            reach={item.reach}
            engagements={item.engagements}
            likes={item.likes}
            comments={item.comments}
            shares={item.shares}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section

export function TopContent({ items, initialSort = "impressions", limit = 3, initialOpenId = null, clientId }: {
  items: TopContentItem[];
  initialSort?: TopContentSort;
  limit?: number;
  /** Open this post's detail modal on mount — used by the preview harness to
   *  screenshot the modal headlessly; unused in production. */
  initialOpenId?: string | null;
  /** Enables native IG reel playback in the detail modal (omit ⇒ iframe-only). */
  clientId?: string;
}) {
  const [sort, setSort] = useState<TopContentSort>(initialSort);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  // Posts found deleted/private on their platform (detected on thumbnail load
  // failure) are dropped from the ranking; filtered BEFORE the slice so the next
  // post promotes into the top N rather than leaving a gap.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const ranked = useMemo(() => {
    const score = (i: TopContentItem) => (sort === "impressions" ? i.reach.value : i.engagements);
    return [...items]
      .filter((i) => !hidden.has(i.id))
      .sort((a, b) => score(b) - score(a))
      .slice(0, limit);
  }, [items, sort, limit, hidden]);

  const openIdx = ranked.findIndex((i) => i.id === openId);
  const openItem = openIdx >= 0 ? ranked[openIdx] : null;

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Top performing content</h2>
          <InfoChip text={SORT_TIP[sort]} />
        </div>
        <Segmented<TopContentSort>
          value={sort}
          onChange={setSort}
          options={[
            { value: "impressions", label: SORT_LABEL.impressions },
            { value: "engagements", label: SORT_LABEL.engagements },
          ]}
          size="sm"
        />
      </div>

      {ranked.length === 0 ? (
        <div className="min-h-[200px] flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
          No content published in this period yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ranked.map((item, i) => (
            <PostCard
              key={item.id}
              item={item}
              rank={i + 1}
              sort={sort}
              onOpen={() => setOpenId(item.id)}
              clientId={clientId}
              onUnavailable={() => setHidden((prev) => new Set(prev).add(item.id))}
            />
          ))}
        </div>
      )}

      {openItem && <PostModal item={openItem} rank={openIdx + 1} sort={sort} onClose={() => setOpenId(null)} clientId={clientId} />}
    </section>
  );
}
