"use client";

/**
 * Content library — a browsable catalogue of a client's recent published posts,
 * split by media type via a segmented tab control (All / Reels / Videos / Posts /
 * Carousels). No engagement metrics here; this is a content catalogue, not a
 * performance ranking (that's <TopContent/>). Clicking a row opens a detail
 * modal with the full caption + inline video playback — same preview affordance
 * as Top Content (it reuses Top Content's `videoEmbed` so playback is identical).
 *
 * Fast switching: the caller passes ONE pre-fetched `items` array (the server
 * fetches the union of "latest N" + "latest 10 of each type" so every tab is
 * populated). Bucketing + slicing happens client-side in a memo, so flipping
 * tabs is instant — no per-tab fetch / spinner.
 *
 *   - All        → latest 20, any type
 *   - Reels      → latest 10 short-form vertical (TikTok / IG Reels / Shorts)
 *   - Videos     → latest 10 standard / long-form video
 *   - Posts      → latest 10 single image / text
 *   - Carousels  → latest 10 albums (often fewer exist — renders gracefully)
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  Film, Clapperboard, Images, Image as ImageIcon, FileText,
  ExternalLink, Play, Maximize2, X, type LucideIcon,
} from "lucide-react";
import type { SocialPlatform } from "@/lib/etl/social";
import { videoEmbed, PostStatGrid, InlineMedia, type ContentMediaType, type ReachKind } from "@/components/top-content";
import { Segmented } from "@/components/ui/segmented";
import { SocialThumb } from "@/components/social-thumb";

export type ContentItem = {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  /** ISO date — "yyyy-MM-dd" or a full ISO timestamp. */
  postedAt: string;
  permalink: string;
  thumbnailUrl: string | null;
  mediaType: ContentMediaType;
  caption: string;
  // Performance — optional; populated by fetchContentLibrary for the detail
  // modal's stat block (the same block as Top Content). Omitted ⇒ block hidden.
  reach?: { kind: ReachKind; value: number };
  engagements?: number;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
};

export type ContentTab = "all" | "reels" | "videos" | "posts" | "carousels";

const PLATFORM: Record<SocialPlatform, { label: string; color: string; logo: string }> = {
  meta_facebook:  { label: "Facebook",  color: "#1877F2", logo: "/brand/social/facebook.png" },
  meta_instagram: { label: "Instagram", color: "#E1306C", logo: "/brand/social/instagram.png" },
  youtube:        { label: "YouTube",   color: "#FF4D4F", logo: "/brand/social/youtube.png" },
  tiktok:         { label: "TikTok",    color: "#25F4EE", logo: "/brand/social/tiktok.png" },
  linkedin:       { label: "LinkedIn",  color: "#0A66C2", logo: "/brand/social/linkedin.png" },
};

const MEDIA: Record<ContentMediaType, { icon: LucideIcon; label: string }> = {
  video:    { icon: Film,         label: "Video" },
  reel:     { icon: Clapperboard, label: "Reel" },
  image:    { icon: ImageIcon,    label: "Photo" },
  carousel: { icon: Images,       label: "Carousel" },
  text:     { icon: FileText,     label: "Text" },
};

const TABS: { key: ContentTab; label: string; match: (m: ContentMediaType) => boolean; cap: number }[] = [
  { key: "all",       label: "All",       match: () => true,                            cap: 20 },
  { key: "reels",     label: "Reels",     match: (m) => m === "reel",                   cap: 10 },
  { key: "videos",    label: "Videos",    match: (m) => m === "video",                  cap: 10 },
  { key: "posts",     label: "Posts",     match: (m) => m === "image" || m === "text",  cap: 10 },
  { key: "carousels", label: "Carousels", match: (m) => m === "carousel",               cap: 10 },
];

function parseDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}
const fmtDate = (iso: string) =>
  parseDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtDateLong = (iso: string) =>
  parseDate(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function Logo({ platform, size = 15 }: { platform: SocialPlatform; size?: number }) {
  const m = PLATFORM[platform];
  return (
    <Image src={m.logo} alt={m.label} width={size} height={size}
      className="object-contain shrink-0" style={{ width: size, height: size }} />
  );
}

export function ContentLibrary({ items, initialTab = "all", initialOpenId = null, clientId }: {
  items: ContentItem[];
  initialTab?: ContentTab;
  /** Open this item's detail modal on mount — used by the preview harness to
   *  screenshot the modal headlessly; unused in production. */
  initialOpenId?: string | null;
  /** Enables native IG reel playback in the detail modal (omit ⇒ iframe-only). */
  clientId?: string;
}) {
  const [tab, setTab] = useState<ContentTab>(initialTab);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  // Posts found deleted/private on their platform (detected on thumbnail load
  // failure) are removed from every bucket — so they vanish from the list and the
  // tab counts, not just show a placeholder.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Sort once, then bucket+slice per tab — all client-side, so switching is free.
  const buckets = useMemo(() => {
    const sorted = [...items]
      .filter((i) => !hidden.has(i.id))
      .sort((a, b) => +parseDate(b.postedAt) - +parseDate(a.postedAt));
    const out = {} as Record<ContentTab, ContentItem[]>;
    for (const t of TABS) out[t.key] = sorted.filter((i) => t.match(i.mediaType)).slice(0, t.cap);
    return out;
  }, [items, hidden]);

  const rows = buckets[tab];
  const openItem = openId ? items.find((i) => i.id === openId) ?? null : null;

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/50 bg-[var(--surface-1)] overflow-hidden shadow-[0_1px_0_0_var(--surface-3)]/20">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[var(--surface-3)]/40">
        <div>
          <h2 className="text-[19px] font-bold text-[var(--text-primary)] leading-none">Content</h2>
          <p className="text-[12px] text-[var(--text-tertiary)] mt-1.5">
            {rows.length} {rows.length === 1 ? "item" : "items"}
          </p>
        </div>
        {/* Type filter — desktop only. On mobile we drop the tab entirely and
            just show the top-20 "all" feed (no switching). */}
        <div className="hidden md:block">
          <Segmented<ContentTab>
            value={tab}
            onChange={setTab}
            options={TABS.map((t) => ({ value: t.key, label: t.label, count: buckets[t.key].length }))}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-16 text-center text-[14px] text-[var(--text-tertiary)]">
          No {tab === "all" ? "content" : tab} in this period.
        </div>
      ) : (
        // own scroll area — ~6-7 rows tall, the rest scrolls within the card
        <ul className="max-h-[520px] overflow-y-auto divide-y divide-[var(--surface-3)]/30">
          {rows.map((item) => (
            <ContentRow
              key={item.id}
              item={item}
              onOpen={() => setOpenId(item.id)}
              clientId={clientId}
              onUnavailable={() => setHidden((prev) => new Set(prev).add(item.id))}
            />
          ))}
        </ul>
      )}

      {openItem && <ContentModal item={openItem} onClose={() => setOpenId(null)} clientId={clientId} />}
    </section>
  );
}

function ContentRow({ item, onOpen, clientId, onUnavailable }: {
  item: ContentItem; onOpen: () => void;
  /** Enables self-healing thumbnail refresh on a dead/expired CDN url. */
  clientId?: string;
  /** Called when the post is detected deleted/private → drop it from the list. */
  onUnavailable?: () => void;
}) {
  const pm = PLATFORM[item.platform];
  const media = MEDIA[item.mediaType];
  const caption = item.caption?.trim() || "No caption";
  const playable = item.mediaType === "video" || item.mediaType === "reel";
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group relative flex w-full items-center gap-3.5 px-5 py-3 text-left transition-colors hover:bg-[var(--surface-2)]/50"
      >
        {/* brand edge on hover */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[2.5px] bg-[var(--ps-yellow)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--surface-2)] ring-1 ring-[var(--surface-3)]/40">
          <SocialThumb
            clientId={clientId}
            itemId={item.id}
            thumbnailUrl={item.thumbnailUrl}
            imgClassName="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
            placeholder={
              <span
                className="flex h-full w-full items-center justify-center"
                style={{ background: `linear-gradient(135deg, ${pm.color}26, var(--surface-3))` }}
              >
                <media.icon size={18} className="text-white/50" />
              </span>
            }
            onUnavailable={onUnavailable}
          />
          <span className="absolute bottom-1 left-1 inline-flex h-5 w-5 items-center justify-center rounded-md bg-black/65 backdrop-blur-sm">
            <media.icon size={11} strokeWidth={2.25} className="text-white" />
          </span>
          {playable && (
            <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/15 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                <Play size={12} strokeWidth={2.5} className="ml-0.5 fill-current" />
              </span>
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Logo platform={item.platform} size={15} />
            <span className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">
              {item.accountName}
            </span>
            <span className="ml-0.5 shrink-0 inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)]/80 px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
              <media.icon size={10} strokeWidth={2.25} /> {media.label}
            </span>
          </div>
          <p className="mt-1 truncate text-[12.5px] text-[var(--text-secondary)]">{caption}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <span className="text-[12px] tabular-nums text-[var(--text-tertiary)]">{fmtDate(item.postedAt)}</span>
          <span aria-hidden className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--text-tertiary)] opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:bg-[var(--surface-3)]/40 group-hover:text-[var(--text-primary)]">
            <Maximize2 size={13} strokeWidth={2.25} />
          </span>
        </div>
      </button>
    </li>
  );
}

function ContentModal({ item, onClose, clientId }: {
  item: ContentItem; onClose: () => void;
  /** Enables native IG reel playback in the modal (omit ⇒ iframe-only). */
  clientId?: string;
}) {
  const embed = videoEmbed(item);
  const pm = PLATFORM[item.platform];
  const media = MEDIA[item.mediaType];

  // FB videos can be portrait (reel) or landscape and the Graph API doesn't say
  // which — measure the cover thumbnail's aspect so a 16:9 box doesn't crop a
  // vertical FB reel. Other platforms' players handle their own aspect.
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

  // FB portrait reel → tall box; everything else keeps the embed's own layout.
  const layout: "wide" | "tall" =
    embed && item.platform === "meta_facebook" && thumbAspect !== null && thumbAspect < 1
      ? "tall"
      : embed?.layout ?? "wide";
  const caption = item.caption?.trim();

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[var(--surface-0)]/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[620px] max-h-[88vh] overflow-y-auto bg-[var(--surface-1)] border border-[var(--surface-3)]/60 rounded-[var(--radius-card)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        {/* header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--surface-3)]/40 bg-[var(--surface-1)]/95 backdrop-blur px-5 py-3.5">
          <Logo platform={item.platform} size={26} />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[var(--text-primary)] truncate">{item.accountName}</div>
            <div className="text-[11px] text-[var(--text-tertiary)]">{fmtDateLong(item.postedAt)} · {pm.label}</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <a href={item.permalink || "#"} target="_blank" rel="noreferrer"
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
              TikTok / Instagram / Facebook); otherwise a static thumbnail */}
          <div className="relative overflow-hidden rounded-xl border border-[var(--surface-3)]/50 bg-black" style={{ minHeight: 220 }}>
            <InlineMedia
              platform={item.platform}
              mediaType={item.mediaType}
              thumbnailUrl={item.thumbnailUrl}
              itemId={item.id}
              embed={embed}
              layout={layout}
              clientId={clientId}
              platformLabel={pm.label}
              placeholder={
                <div
                  className="relative flex aspect-[16/10] items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${pm.color}26, var(--surface-3))` }}
                >
                  <media.icon size={46} className="text-white/30" />
                </div>
              }
              overlay={
                <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-black/55 backdrop-blur-sm text-[11px] font-semibold text-white">
                  <media.icon size={13} strokeWidth={2.25} /> {media.label}
                </span>
              }
            />
          </div>

          {/* caption */}
          {caption ? (
            <p className="text-[14px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">{caption}</p>
          ) : (
            <p className="text-[13px] italic text-[var(--text-tertiary)]">No caption</p>
          )}

          {/* performance — same stat block as Top Content */}
          {item.reach && (
            <PostStatGrid
              platform={item.platform}
              reach={item.reach}
              engagements={item.engagements ?? 0}
              likes={item.likes}
              comments={item.comments}
              shares={item.shares}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
