"use client";

/**
 * Socials explorer — tiles + trend chart + per-platform breakdown.
 *
 * Two chart shapes:
 *   - Followers (absolute, stable, additive): STACKED bands — total height =
 *     all followers, like Plannable. Tile/rows show the gained COUNT.
 *   - Impressions/Engagements/Profile visits/Link clicks (volatile period
 *     totals): OVERLAID lines from baseline 0, free to cross. % change.
 *
 * Total | By platform toggle, tile-click drives the metric, hovering a row
 * spotlights that platform in the chart.
 */
import { useMemo, useState } from "react";
import Image from "next/image";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Info, Users, Eye, Zap, UserRound, Link2, CircleDashed, Clock, Percent, Timer, PlayCircle, Video, Radar, Share2, Bookmark, type LucideIcon } from "lucide-react";
import { TickingNumber } from "@/components/ticking-number";
import { Segmented } from "@/components/ui/segmented";
import type { SocialsAnalytics, MetricAnalytics, MetricKey } from "@/lib/socials-timeseries";
import type { SocialPlatform } from "@/lib/etl/social";

const PLATFORM_META: Record<SocialPlatform, { label: string; color: string; logo: string }> = {
  meta_facebook:  { label: "Facebook",  color: "#1877F2", logo: "/brand/social/facebook.png" },
  meta_instagram: { label: "Instagram", color: "#E1306C", logo: "/brand/social/instagram.png" },
  youtube:        { label: "YouTube",   color: "#FF4D4F", logo: "/brand/social/youtube.png" },
  tiktok:         { label: "TikTok",    color: "#25F4EE", logo: "/brand/social/tiktok.png" },
  linkedin:       { label: "LinkedIn",  color: "#0A66C2", logo: "/brand/social/linkedin.png" },
};

const TILE_DEFS: Array<{ key: MetricKey; label: string; icon: LucideIcon; tooltip: string }> = [
  { key: "follows_gained", label: "Followers",     icon: Users,
    tooltip: "Combined followers and subscribers across the connected platforms with full history for this range. The badge shows how many you gained during the period." },
  { key: "impressions",    label: "Impressions",   icon: Eye,
    tooltip: "Total times your posts and videos were shown during the period — repeat views included — across Facebook, Instagram, and YouTube." },
  { key: "engagements",    label: "Engagements",   icon: Zap,
    tooltip: "Likes, comments, shares, saves, and reactions your content earned during the period." },
  { key: "profile_visits", label: "Profile visits", icon: UserRound,
    tooltip: "Times people opened your profile or Page during the period (Facebook and Instagram — other platforms don't report this)." },
  { key: "link_clicks",    label: "Link clicks",   icon: Link2,
    tooltip: "Taps on the link in your Instagram bio during the period — organic only, never ad clicks." },
];

/** Icon per scorecard key — reuses the metric icons from the top of the
 *  dashboard and covers the derived/TikTok-only cards too. */
const METRIC_ICONS: Record<string, LucideIcon> = {
  followers: Users, follows_gained: Users,
  reach: Radar,
  impressions: Eye,
  engagements: Zap,
  watch_time: Clock,
  profile_visits: UserRound,
  link_clicks: Link2,
  engrate: Percent,
  avgdur: Timer,
  avgviews: PlayCircle,
  videos: Video,
  shares: Share2,
  saves: Bookmark,
};
const metricIcon = (key: string): LucideIcon => METRIC_ICONS[key] ?? CircleDashed;

/** Plain-English explanation per scorecard key, shown in the hover tooltip on
 *  each supporting tile (the corner chip morphs from the metric icon to an "i").
 *  Covers the breakdown's derived/TikTok-only cards too. */
const METRIC_TIPS: Record<string, string> = {
  reach: "Unique accounts that saw your content at least once during the period — repeat views aren't counted.",
  impressions: "Total times your posts or videos were shown during the period, repeat views included.",
  engagements: "Likes, comments, shares, saves, and reactions your content earned during the period.",
  watch_time: "Total time people spent watching your videos during the period.",
  profile_visits: "Times people opened your profile or Page during the period.",
  link_clicks: "Taps on your bio or profile link during the period — organic only, never ad clicks.",
  engrate: "Engagements divided by impressions — the share of viewers who interacted with your content.",
  avgdur: "Average time viewers spent watching each video before leaving.",
  avgviews: "Average number of views per video posted during the period.",
  videos: "Number of videos posted during the period.",
  shares: "Times people shared or reposted your content during the period.",
  saves: "Times people saved your posts during the period (Instagram only — other platforms don't report saves).",
};

const fmtFull = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
const fmtCompact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
  : Math.abs(n) >= 1_000 ? (n / 1_000).toFixed(1) + "K"
  : String(n);
function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Recent days are still "settling": platforms revise the freshest data
 *  (YouTube lags ~2 days, Meta restates for a couple), and our nightly cron
 *  re-pulls a 7-day window to correct them. We render this trailing window as a
 *  dashed line + shaded band so the numbers aren't read as final. Tunable. */
const SETTLING_DAYS = 4;

/** Shift a yyyy-MM-dd string by `delta` days (local-time, matches fmtDay). */
function shiftDay(dayStr: string, delta: number): string {
  const [y, m, d] = dayStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

const badgeCls = (up: boolean) =>
  "inline-flex items-center justify-center gap-0.5 text-[12px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md " +
  (up ? "text-[var(--positive)] bg-[var(--positive)]/10" : "text-[var(--negative)] bg-[var(--negative)]/10");

function pctText(pct: number | null): string {
  if (pct === null || !isFinite(pct)) return "";
  const abs = Math.abs(pct);
  const t = abs >= 1000 ? "999+" : abs >= 10 ? Math.round(abs).toString() : abs.toFixed(1);
  return `${pct >= 0 ? "↑" : "↓"} ${t}%`;
}
function countText(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return "—";
  return `${n >= 0 ? "↑" : "↓"} ${Math.abs(n).toLocaleString("en-US")}`;
}
/** Uniform badge width for a column = widest text × ~per-char + padding. */
function colMinW(texts: string[]): number | undefined {
  const max = Math.max(0, ...texts.map((t) => t.length));
  return max ? Math.ceil(max * 7.6) + 16 : undefined;
}

function DeltaPct({ pct, minW }: { pct: number | null; minW?: number }) {
  if (pct === null || !isFinite(pct)) return null;
  return <span className={badgeCls(pct >= 0)} style={minW ? { minWidth: minW } : undefined}>{pctText(pct)}</span>;
}

function DeltaCount({ n, minW }: { n: number | null | undefined; minW?: number }) {
  if (n === null || n === undefined) return null;
  if (n === 0) return <span className="inline-flex justify-center text-[12px] text-[var(--text-tertiary)]" style={minW ? { minWidth: minW } : undefined}>—</span>;
  return <span className={badgeCls(n >= 0)} style={minW ? { minWidth: minW } : undefined}>{countText(n)}</span>;
}

function Logo({ platform, size = 22 }: { platform: SocialPlatform; size?: number }) {
  const m = PLATFORM_META[platform];
  return (
    <span className="inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <Image src={m.logo} alt={m.label} width={size} height={size} className="object-contain" style={{ width: size, height: size }} />
    </span>
  );
}

/** Chart tooltip — collapses the solid/dashed split back into one row per
 *  series, and shows a "still settling" tag for days inside the trailing
 *  incomplete window. */
type TipItem = { value?: number | null; dataKey?: string | number; color?: string };
function ChartTooltip(props: {
  active?: boolean;
  payload?: TipItem[];
  label?: string | number;
  settlingFromStr?: string;
  activeLabel?: string;
}) {
  const { active, payload, label, settlingFromStr, activeLabel } = props;
  if (!active || !payload?.length) return null;
  const day = String(label ?? "");
  const settling = !!settlingFromStr && day >= settlingFromStr;

  // One row per series — the dashed tail shares a base key with its solid line.
  const seen = new Map<string, { name: string; value: number; color: string }>();
  for (const item of payload) {
    if (typeof item.value !== "number") continue;
    let key = String(item.dataKey ?? "");
    if (key.endsWith("__dash")) key = key.slice(0, -6);
    if (seen.has(key)) continue;
    const meta = PLATFORM_META[key as SocialPlatform];
    seen.set(key, {
      name: key === "total" ? (activeLabel ?? "Total") : (meta?.label ?? key),
      value: item.value,
      color: key === "total" ? "var(--ps-yellow)" : (meta?.color ?? item.color ?? "var(--text-primary)"),
    });
  }
  if (seen.size === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--surface-3)] bg-[var(--surface-0)] px-3 py-2 text-[12px] shadow-xl">
      <div className="mb-1 text-[var(--text-secondary)]">{fmtDay(day)}</div>
      {[...seen.values()].map((e) => (
        <div key={e.name} className="flex items-center justify-between gap-4 tabular-nums">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: e.color }} />
            {e.name}
          </span>
          <span className="font-semibold text-[var(--text-primary)]">{e.value.toLocaleString("en-US")}</span>
        </div>
      ))}
      {settling && (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-[var(--surface-3)]/50 pt-1.5 text-[11px] text-[var(--accent-fg)]">
          <CircleDashed size={12} strokeWidth={2.25} /> Data still settling — may update
        </div>
      )}
    </div>
  );
}

/**
 * One metric tile. Premium stat-row behaviour:
 *   - value counts up/down (TickingNumber) when the period changes;
 *   - the SELECTED tile lifts, keeps the yellow glow, and renders its number
 *     brighter than the rest (the unselected numbers sit at --text-secondary);
 *   - the corner chip shows a per-metric EMOJI that morphs into an "i" while
 *     the tile is hovered; hovering the chip opens a tooltip that stays open
 *     while the pointer is on the chip OR the explanation card (the card is a
 *     descendant of the hover wrapper, with a padding bridge, so there's no gap
 *     to fall through) and only closes when you leave the card.
 */
function StatTile({
  def, metric, active, onSelect,
}: {
  def: { key: MetricKey; label: string; icon: LucideIcon; tooltip: string };
  metric: MetricAnalytics;
  active: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const showI = hover || tipOpen; // metric icon → "i" while the box is engaged
  const Icon = def.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={
        // Desktop only: the selected tile lifts + glows (it drives the trend
        // chart). On MOBILE the chart is hidden, so there's nothing to select —
        // tiles are flat static stats with no click/hover/active styling
        // (everything is md:-gated).
        "group relative text-left rounded-[var(--radius-card)] p-4 flex flex-col gap-2.5 bg-[var(--surface-1)] " +
        "border border-[var(--surface-3)]/40 transition-all duration-200 ease-out will-change-transform " +
        (active
          ? "md:z-20 md:-translate-y-0.5 md:border-[var(--ps-yellow)] md:ring-1 md:ring-[var(--ps-yellow)]/40 md:shadow-lg md:shadow-[var(--ps-yellow)]/10"
          : "md:z-0 md:hover:z-20 md:hover:-translate-y-0.5 md:hover:border-[var(--surface-3)] md:hover:shadow-lg md:hover:shadow-black/20")
      }
    >
      {/* premium corner sheen on the active tile — desktop only */}
      <span
        aria-hidden
        className={"pointer-events-none absolute inset-0 rounded-[var(--radius-card)] transition-opacity duration-300 " + (active ? "opacity-0 md:opacity-100" : "opacity-0")}
        style={{ background: "radial-gradient(120% 80% at 0% 0%, rgba(255,209,0,0.10), transparent 60%)" }}
      />

      <div className="relative flex items-center justify-between gap-1.5">
        <span className={"text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.1em] truncate transition-colors text-[var(--text-secondary)] " + (active ? "md:text-[var(--text-primary)]" : "")}>{def.label}</span>

        <span
          className="relative inline-flex items-center justify-center shrink-0"
          onMouseEnter={() => setTipOpen(true)}
          onMouseLeave={() => setTipOpen(false)}
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className={"relative inline-flex items-center justify-center h-7 w-7 rounded-lg cursor-help text-[var(--accent-fg)] transition-colors duration-200 " +
              (showI ? "bg-[var(--surface-3)]" : "bg-[var(--surface-3)]/45")}
            aria-label={`${def.label}: ${def.tooltip}`}
          >
            <span aria-hidden className={"absolute inset-0 flex items-center justify-center transition-all duration-200 " + (showI ? "md:opacity-0 md:scale-50 md:rotate-90" : "opacity-100 scale-100 rotate-0")}>
              <Icon size={16} strokeWidth={2.25} />
            </span>
            <span aria-hidden className={"absolute inset-0 flex items-center justify-center transition-all duration-200 " + (showI ? "opacity-0 md:opacity-100 md:scale-100 md:rotate-0" : "opacity-0 scale-50 -rotate-90")}>
              <Info size={16} strokeWidth={2.5} />
            </span>
          </span>

          {tipOpen && (
            <span className="hidden md:block absolute right-0 top-full z-30 w-60 pt-2 normal-case tracking-normal cursor-default">
              <span className="block p-2.5 rounded-md bg-[var(--surface-0)] border border-[var(--surface-3)] shadow-xl">
                <span className="block text-[11px] font-semibold text-[var(--text-primary)] mb-1">{def.label}</span>
                <span className="block text-[11px] text-[var(--text-secondary)] leading-snug">{def.tooltip}</span>
              </span>
            </span>
          )}
        </span>
      </div>

      {/* nowrap + smaller mobile value so a 6-digit number and its delta stay
          on ONE line in a narrow 2-up tile (the % was wrapping below). */}
      <div className="relative flex flex-nowrap items-center gap-1.5 sm:gap-2 min-w-0">
        <TickingNumber
          value={metric.total}
          format="number"
          className={"text-[17px] sm:text-[22px] lg:text-[25px] leading-none font-bold tabular-nums tracking-tight whitespace-nowrap transition-colors duration-200 " +
            (metric.total === null
              ? "text-[var(--text-tertiary)]"
              : "text-[var(--text-primary)] " +
                (active
                  ? "md:[text-shadow:0_0_18px_rgba(255,209,0,0.25)]"
                  : "md:text-[var(--text-secondary)] md:group-hover:text-[var(--text-primary)]"))}
        />
        <span className="shrink-0">{metric.isAbsolute ? <DeltaCount n={metric.changeAbs} /> : <DeltaPct pct={metric.changePct} />}</span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-platform scorecard — tabs that drill into one platform's KPIs (incl.
// metrics NOT in the top tiles: reach, watch time, engagement rate, TikTok
// content). Tabs are coverage-gated (a platform only appears when it has full
// data for the selected range, same rule as the chart).

const fmtWatchMin = (min: number) =>
  min >= 120 ? `${(min / 60).toLocaleString("en-US", { maximumFractionDigits: 0 })} hrs` : `${fmtFull(min)} min`;
const fmtDuration = (sec: number) => {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** % change of engagement rate (eng ÷ impressions) vs the comparison period,
 *  recovered from each metric's own period-over-period change. null when
 *  either side lacks comparison data (so the badge just hides). */
function engRateChangePct(eng: { total: number; changePct: number | null }, imp: { total: number; changePct: number | null }): number | null {
  if (eng.changePct == null || imp.changePct == null) return null;
  const prevEng = eng.total / (1 + eng.changePct / 100);
  const prevImp = imp.total / (1 + imp.changePct / 100);
  if (prevImp <= 0) return null;
  const prevRate = prevEng / prevImp;
  if (prevRate <= 0) return null;
  return ((eng.total / imp.total) / prevRate - 1) * 100;
}

/** Desktop column count for the supporting-metric grid, tailored to how many
 *  metrics a platform reports so every row stays full — no orphan tile on a
 *  half-empty row. Mobile is always 2-up; the lg breakpoint carries the
 *  count-specific layout (this is the per-platform tailoring).
 *    3 → one row of 3   ·   4 → one row of 4   ·   5 → one row of 5
 *    6 → two rows of 3  ·   else → 4-up and let it wrap. */
/** A metric's change indicator, left-aligned. Wrapped in a row-flex so the
 *  pill keeps its intrinsic width (a flex-COLUMN parent would stretch it edge
 *  to edge). `none` renders a fixed-height blank so tiles in a row align. */
function ChangeBadge({ change, minW }: { change: ScoreCard["change"]; minW?: number }) {
  return (
    <span className="flex">
      {change.kind === "abs" ? <DeltaCount n={change.n} minW={minW} />
        : change.kind === "pct" ? <DeltaPct pct={change.pct} minW={minW} />
        : <span className="h-[22px]" aria-hidden />}
    </span>
  );
}

type ScoreCard = {
  key: string;
  label: string;
  valueText: string;
  change: { kind: "abs"; n: number | null | undefined } | { kind: "pct"; pct: number | null } | { kind: "none" };
};

/** Shares + saves tiles for a platform, from analytics.postAggregates
 *  (migration 030). Shares show for any platform that reports them
 *  (FB/IG/TikTok via posts, YouTube via its daily metric); saves are
 *  Instagram-only — the read layer already nulls saves elsewhere, so this just
 *  surfaces whatever it provides. */
function postAggCards(analytics: SocialsAnalytics, p: SocialPlatform): ScoreCard[] {
  const agg = analytics.postAggregates[p];
  if (!agg) return [];
  const cards: ScoreCard[] = [];
  if (agg.shares != null) {
    cards.push({
      key: "shares", label: "Shares", valueText: fmtFull(agg.shares),
      change: agg.sharesChangePct != null ? { kind: "pct", pct: agg.sharesChangePct } : { kind: "none" },
    });
  }
  if (agg.saves != null) {
    cards.push({
      key: "saves", label: "Saves", valueText: fmtFull(agg.saves),
      change: agg.savesChangePct != null ? { kind: "pct", pct: agg.savesChangePct } : { kind: "none" },
    });
  }
  return cards;
}

/** Build a platform's KPI cards. Most come from the metric breakdowns (so the
 *  set auto-adapts to what each platform reports); plus derived Engagement rate
 *  and YouTube avg view duration, TikTok's content aggregates, and the
 *  shares/saves tiles from social_posts. */
function buildPlatformCards(analytics: SocialsAnalytics, p: SocialPlatform): ScoreCard[] {
  if (p === "tiktok") {
    const cards: ScoreCard[] = [];
    const fRow = analytics.metrics.follows_gained.breakdown.find((b) => b.platform === p);
    if (fRow) cards.push({ key: "followers", label: "Followers", valueText: fmtFull(fRow.total), change: { kind: "abs", n: fRow.changeAbs } });
    const tt = analytics.tiktok;
    if (tt) {
      cards.push({ key: "avgviews", label: "Avg views / video", valueText: tt.avgViews == null ? "—" : fmtFull(tt.avgViews), change: { kind: "none" } });
      cards.push({ key: "engrate", label: "Engagement rate", valueText: tt.engRatePct == null ? "—" : `${tt.engRatePct.toFixed(1)}%`, change: { kind: "none" } });
      cards.push({ key: "videos", label: "Videos posted", valueText: fmtFull(tt.videosPosted), change: { kind: "none" } });
    }
    cards.push(...postAggCards(analytics, p));
    return cards;
  }

  const order: Array<{ mk: MetricKey; label: string }> = [
    { mk: "follows_gained", label: p === "youtube" ? "Subscribers" : "Followers" },
    { mk: "reach", label: "Reach" },
    { mk: "impressions", label: p === "youtube" ? "Views" : "Impressions" },
    { mk: "engagements", label: "Engagements" },
    { mk: "watch_time", label: "Watch time" },
    { mk: "profile_visits", label: "Profile visits" },
    { mk: "link_clicks", label: "Link clicks" },
  ];
  const cards: ScoreCard[] = [];
  for (const { mk, label } of order) {
    const m = analytics.metrics[mk];
    const row = m.breakdown.find((b) => b.platform === p);
    if (!row) continue;
    cards.push({
      key: mk,
      label,
      valueText: mk === "watch_time" ? fmtWatchMin(row.total) : fmtFull(row.total),
      change: m.isAbsolute ? { kind: "abs", n: row.changeAbs } : { kind: "pct", pct: row.changePct },
    });
  }
  // Shares (FB/IG/TikTok/YouTube) + saves (IG) — sit with the raw metrics,
  // before the derived rates below.
  cards.push(...postAggCards(analytics, p));
  // Engagement rate (derived: engagements ÷ impressions/views).
  const eng = analytics.metrics.engagements.breakdown.find((b) => b.platform === p);
  const imp = analytics.metrics.impressions.breakdown.find((b) => b.platform === p);
  if (eng && imp && imp.total > 0) {
    const rc = engRateChangePct(eng, imp);
    cards.push({ key: "engrate", label: "Engagement rate", valueText: `${((eng.total / imp.total) * 100).toFixed(1)}%`, change: rc != null ? { kind: "pct", pct: rc } : { kind: "none" } });
  }
  // Avg view duration (YouTube, derived: watch minutes ÷ views).
  if (p === "youtube") {
    const wt = analytics.metrics.watch_time.breakdown.find((b) => b.platform === p);
    const vw = analytics.metrics.impressions.breakdown.find((b) => b.platform === p);
    if (wt && vw && vw.total > 0) cards.push({ key: "avgdur", label: "Avg view duration", valueText: fmtDuration((wt.total * 60) / vw.total), change: { kind: "none" } });
  }
  return cards;
}

/** The headline metric for a platform (followers / subscribers), rendered as a
 *  full-bleed feature card that carries the platform's identity. Content is
 *  packed to the LEFT with an oversized faded logo bleeding off the right edge,
 *  so there's no dead gulf between identity and number. */
function PrimaryFeature({ platform, card }: { platform: SocialPlatform; card: ScoreCard }) {
  const meta = PLATFORM_META[platform];
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border p-5 sm:p-6 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20"
      style={{
        borderColor: `${meta.color}3d`,
        background: `linear-gradient(105deg, ${meta.color}26, ${meta.color}0d 34%, var(--surface-2) 78%)`,
      }}
    >
      {/* oversized brand glyph, faded, bleeding off the right edge — drifts + grows
          on hover. Desktop only: on mobile it sat behind the (now smaller) number
          and read as clutter. */}
      <span aria-hidden className="hidden md:block pointer-events-none absolute -right-5 -bottom-12 opacity-[0.07] blur-[0.2px] transition-all duration-500 ease-out group-hover:scale-110 group-hover:-translate-x-2 group-hover:opacity-[0.11]">
        <Logo platform={platform} size={190} />
      </span>
      {/* light sweep on hover */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full" style={{ background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.06), transparent)" }} />

      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-3 sm:gap-x-8 sm:gap-y-4">
        <span className="flex items-center gap-3 min-w-0">
          <span className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl flex items-center justify-center shrink-0 ring-1 ring-inset" style={{ background: `${meta.color}2b`, color: meta.color }}>
            <Logo platform={platform} size={26} />
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-[16px] sm:text-[17px] font-bold leading-tight truncate" style={{ color: meta.color }}>{meta.label}</span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] mt-0.5">{card.label}</span>
          </span>
        </span>

        {/* Smaller value on mobile + nowrap so a big follower count never
            overflows the card (it wraps to its own line under the identity). */}
        <span className="flex items-end gap-2 sm:gap-2.5 min-w-0">
          <span className="text-[26px] sm:text-[42px] font-bold leading-[0.9] tabular-nums tracking-tight text-[var(--text-primary)] whitespace-nowrap">{card.valueText}</span>
          <ChangeBadge change={card.change} />
        </span>
      </div>
    </div>
  );
}


/** Split N supporting tiles into BALANCED rows of ≤4 (5 → [3,2], 6 → [3,3],
 *  7 → [4,3]), so an incomplete set reads as tidy centered rows rather than a
 *  lone orphan. Restored from the pre-a224191 layout. */
function supportRows(n: number): number[] {
  if (n <= 4) return [n];
  const rows = Math.ceil(n / 4);
  const base = Math.floor(n / rows);
  let rem = n - base * rows;
  return Array.from({ length: rows }, () => base + (rem-- > 0 ? 1 : 0));
}

/** Per-row grid classes keyed by the row's tile count. The max-width caps each
 *  row to a tight block of ≤280px tiles; with mx-auto on the row, an incomplete
 *  row sits CENTERED under the full ones (the "centered if not 4" look). This is
 *  the desktop/tablet container, so columns are 2-up at sm → full count at lg. */
const SUPPORT_ROW_GRID: Record<number, string> = {
  1: "max-w-[280px] grid-cols-1",
  2: "max-w-[572px] grid-cols-2",
  3: "max-w-[864px] grid-cols-2 lg:grid-cols-3",
  4: "max-w-[1156px] grid-cols-2 lg:grid-cols-4",
};

/** A supporting metric tile — narrow (Facebook width), filling its grid column.
 *  The corner chip carries the metric icon in the platform's colour and morphs
 *  into an "i" on hover, opening a tooltip that explains the metric (same pattern
 *  as the top-of-page StatTiles). Lifts with a brand-tinted sheen on hover. */
function SupportTile({ platform, card }: { platform: SocialPlatform; card: ScoreCard }) {
  const meta = PLATFORM_META[platform];
  const Icon = metricIcon(card.key);
  const tip = METRIC_TIPS[card.key];
  const [hover, setHover] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const showI = hover || tipOpen;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative w-full max-w-[280px] rounded-xl border border-[var(--surface-3)]/40 bg-[var(--surface-2)]/30 px-3 py-3 sm:px-4 sm:py-3.5 flex flex-col gap-2 sm:gap-2.5 min-w-0 transition-all duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:border-[var(--surface-3)] hover:shadow-lg hover:shadow-black/25"
    >
      {/* brand sheen, fades in on hover (clipped to the tile radius) */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: `radial-gradient(120% 80% at 0% 0%, ${meta.color}14, transparent 60%)` }} />

      <div className="relative flex items-center justify-between gap-1.5">
        <span className="text-[10px] sm:text-[10.5px] font-semibold uppercase tracking-[0.04em] sm:tracking-[0.1em] text-[var(--text-tertiary)] truncate">{card.label}</span>
        {tip && (
          <span
            className="relative inline-flex items-center justify-center shrink-0"
            onMouseEnter={() => setTipOpen(true)}
            onMouseLeave={() => setTipOpen(false)}
          >
            <span
              className="relative inline-flex items-center justify-center h-7 w-7 rounded-lg cursor-help transition-colors duration-200"
              style={{ color: meta.color, background: showI ? `${meta.color}29` : `${meta.color}14` }}
              aria-label={`${card.label}: ${tip}`}
            >
              <span aria-hidden className={"absolute inset-0 flex items-center justify-center transition-all duration-200 " + (showI ? "md:opacity-0 md:scale-50 md:rotate-90" : "opacity-100 scale-100 rotate-0")}>
                {/* eslint-disable-next-line react-hooks/static-components -- metricIcon is a static lookup (METRIC_ICONS[key] ?? CircleDashed) returning a module-level lucide icon, not a per-render component; same pattern as StatTile's `const Icon = def.icon`. */}
                <Icon size={15} strokeWidth={2.25} />
              </span>
              <span aria-hidden className={"absolute inset-0 flex items-center justify-center transition-all duration-200 " + (showI ? "opacity-0 md:opacity-100 md:scale-100 md:rotate-0" : "opacity-0 scale-50 -rotate-90")}>
                <Info size={15} strokeWidth={2.5} />
              </span>
            </span>
            {tipOpen && (
              <span className="hidden md:block absolute right-0 top-full z-30 w-56 pt-2 normal-case tracking-normal cursor-default">
                <span className="block p-2.5 rounded-md bg-[var(--surface-0)] border border-[var(--surface-3)] shadow-xl">
                  <span className="block text-[11px] font-semibold text-[var(--text-primary)] mb-1">{card.label}</span>
                  <span className="block text-[11px] text-[var(--text-secondary)] leading-snug">{tip}</span>
                </span>
              </span>
            )}
          </span>
        )}
      </div>

      {/* Smaller value on mobile so the full number fits in a 2-up tile next to
          its delta badge (was truncating to e.g. "71,2…"). */}
      <div className="relative flex items-center gap-1 sm:gap-2 min-w-0">
        <span className="text-[14px] sm:text-[19px] font-bold tabular-nums text-[var(--text-primary)] leading-none truncate">{card.valueText}</span>
        <span className="shrink-0"><ChangeBadge change={card.change} /></span>
      </div>
    </div>
  );
}

export function PlatformScorecard({ analytics, initialPlatform }: { analytics: SocialsAnalytics; initialPlatform?: SocialPlatform }) {
  // Covered platforms = those present in any metric breakdown (so TikTok only
  // shows when it has full-range data — same gate as the chart).
  const tabPlatforms = useMemo(() => {
    const set = new Set<SocialPlatform>();
    for (const m of Object.values(analytics.metrics)) for (const b of m.breakdown) set.add(b.platform);
    return (["meta_facebook", "meta_instagram", "youtube", "tiktok", "linkedin"] as SocialPlatform[]).filter((p) => set.has(p));
  }, [analytics]);

  const [active, setActive] = useState<SocialPlatform | null>(initialPlatform ?? null);
  const activeP = active && tabPlatforms.includes(active) ? active : tabPlatforms[0] ?? null;
  const cards = useMemo(() => (activeP ? buildPlatformCards(analytics, activeP) : []), [analytics, activeP]);
  if (!activeP) return null;
  const primary = cards[0];
  const rest = cards.slice(1);

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-4 sm:p-5 flex flex-col gap-4">
      {/* title + platform tabs (active tab carries the platform's brand color) */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Platform breakdown</h2>
        <div className="flex flex-wrap gap-1.5">
          {tabPlatforms.map((p) => {
            const on = p === activeP;
            const c = PLATFORM_META[p].color;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setActive(p)}
                aria-pressed={on}
                className={"inline-flex items-center gap-1.5 h-8 pl-1.5 pr-3 rounded-full border text-[12.5px] font-medium transition-all " +
                  (on ? "text-[var(--text-primary)]" : "border-[var(--surface-3)]/50 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--surface-3)]")}
                style={on ? { borderColor: c, background: `${c}1f` } : undefined}
              >
                <Logo platform={p} size={18} />
                {PLATFORM_META[p].label}
              </button>
            );
          })}
        </div>
      </div>

      {/* headline metric — full-bleed feature card carrying platform identity */}
      {primary && <PrimaryFeature platform={activeP} card={primary} />}

      {/* Supporting metrics. Desktop/tablet shows ALL of them in the original
          balanced rows (≤4 each) centered via mx-auto ("centered if not 4").
          Mobile shows only the 4 most important (rest is ordered by importance)
          as a tidy 2×2 — fewer than 4 centers the last tile on an odd count. */}
      {rest.length > 0 && (
        <>
          {/* Mobile: the 4 most important metrics only (2×2). */}
          {(() => {
            const top = rest.slice(0, 4);
            return (
              <div className={"grid grid-cols-2 gap-3 sm:hidden " +
                (top.length % 2 === 1 ? "[&>*:last-child]:col-span-2 [&>*:last-child]:mx-auto [&>*:last-child]:w-[calc(50%-0.375rem)]" : "")}>
                {top.map((c) => (
                  <SupportTile key={c.key} platform={activeP} card={c} />
                ))}
              </div>
            );
          })()}
          {/* Desktop/tablet: balanced, centered rows. */}
          <div className="hidden sm:flex sm:flex-col gap-3">
            {(() => {
              let i = 0;
              return supportRows(rest.length).map((size, ri) => {
                const row = rest.slice(i, i + size);
                i += size;
                return (
                  <div key={ri} className={`grid w-full mx-auto gap-3 justify-items-center ${SUPPORT_ROW_GRID[size] ?? SUPPORT_ROW_GRID[4]}`}>
                    {row.map((c) => (
                      <SupportTile key={c.key} platform={activeP} card={c} />
                    ))}
                  </div>
                );
              });
            })()}
          </div>
        </>
      )}
    </section>
  );
}

export function SocialsExplorer({ analytics, periodLabel, dataEndStr }: { analytics: SocialsAnalytics; periodLabel: string; dataEndStr?: string }) {
  const [metricKey, setMetricKey] = useState<MetricKey>("impressions");
  const [mode, setMode] = useState<"total" | "by_platform">("by_platform");
  const [hidden, setHidden] = useState<Set<SocialPlatform>>(new Set());
  const [hovered, setHovered] = useState<SocialPlatform | null>(null);

  const metric = analytics.metrics[metricKey];
  const isAbs = !!metric.isAbsolute;
  const activeLabel = TILE_DEFS.find((t) => t.key === metricKey)?.label ?? "";
  const contributors = metric.breakdown.map((b) => b.platform);
  const visible = contributors.filter((p) => !hidden.has(p));
  const totalByPlat = useMemo(() => new Map(metric.breakdown.map((b) => [b.platform, b.total])), [metric.breakdown]);

  // Largest first = drawn behind, so smaller platforms stay visible on top
  // (e.g. YouTube at ~1 isn't buried under Instagram). Always OVERLAID, never
  // stacked — each platform sits at its TRUE value.
  const renderOrder = useMemo(() => {
    const sorted = [...visible].sort((a, b) => (totalByPlat.get(a) ?? 0) - (totalByPlat.get(b) ?? 0));
    return sorted.reverse();
  }, [visible, totalByPlat]);

  // One value per series per day — NO split. The still-settling tail is drawn
  // dashed by overlaying the SAME smooth curve with a horizontal stroke
  // gradient (opaque→transparent at the boundary), so the line stays a single
  // continuous spline and there's no kink where solid meets dashed.
  const chartData = useMemo(() => {
    return metric.series.map((pt) => {
      const o: Record<string, number | string | null> = { day: pt.day };
      if (mode === "by_platform") {
        for (const p of visible) { const v = pt[p]; o[p] = typeof v === "number" ? v : 0; }
      } else {
        let total = 0; let any = false;
        for (const p of visible) { const v = pt[p]; if (typeof v === "number") { total += v; any = true; } }
        o.total = any ? total : null;
      }
      return o;
    });
  }, [metric.series, mode, visible]);

  // Trailing "still settling" window, relative to the freshest stored day.
  const settlingFromStr = dataEndStr ? shiftDay(dataEndStr, -(SETTLING_DAYS - 1)) : "";

  // Fraction (0..1) across the x-axis where each line flips solid → dashed: the
  // first still-settling day. null = no settling days in range (fully solid).
  const dashFrac = useMemo(() => {
    if (!settlingFromStr || chartData.length < 2) return null;
    const idx = chartData.findIndex((d) => String(d.day) >= settlingFromStr);
    return idx < 0 ? null : idx / (chartData.length - 1);
  }, [chartData, settlingFromStr]);

  const toggle = (p: SocialPlatform) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });

  // Uniform badge width per column = widest badge in that column.
  const pctMinW = useMemo(
    () => colMinW([...metric.breakdown.map((b) => pctText(b.changePct)), pctText(metric.changePct)]),
    [metric],
  );
  const gainedMinW = useMemo(
    () => (isAbs ? colMinW([...metric.breakdown.map((b) => countText(b.changeAbs)), countText(metric.changeAbs)]) : undefined),
    [metric, isAbs],
  );

  // Full-width grid; number columns spread across the right (Plannable-style),
  // not jammed at the far edge.
  const gridCls = isAbs ? "grid-cols-[1.7fr_1fr_1fr_1fr]" : "grid-cols-[2.2fr_1fr_1fr]";

  return (
    <div className="flex flex-col gap-4">
      {/* Tiles.
          `isolate` creates a stacking context so the active tile's z-20 (and
          its tooltip's z-30) stay contained HERE instead of escaping to the
          page root, where they'd out-rank — and paint over — the sticky
          header's client-switcher dropdown (header is z-10, dropdown z-50,
          but both live inside the header's own stacking context). */}
      <section className="isolate grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 [&>*:last-child]:max-sm:col-span-2 [&>*:last-child]:max-sm:mx-auto [&>*:last-child]:max-sm:w-[calc(50%-0.3125rem)]">
        {TILE_DEFS.map((def) => (
          <StatTile
            key={def.key}
            def={def}
            metric={analytics.metrics[def.key]}
            active={def.key === metricKey}
            onSelect={() => setMetricKey(def.key)}
          />
        ))}
      </section>

      {/* Chart + per-platform breakdown — desktop only. On mobile we keep just
          the stat tiles above (no graphs); the per-platform numbers live in the
          Platform scorecard below. */}
      <section className="hidden md:block bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{activeLabel}</h2>
            <span className="text-[12px] text-[var(--text-tertiary)]">{periodLabel}</span>
          </div>
          <Segmented<"total" | "by_platform">
            value={mode}
            onChange={setMode}
            size="sm"
            options={[
              { value: "total", label: "Total" },
              { value: "by_platform", label: "By platform" },
            ]}
          />
        </div>

        {contributors.length === 0 ? (
          <div className="min-h-[240px] flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
            No daily data for {activeLabel.toLowerCase()} in this period yet.
          </div>
        ) : (
          <div style={{ width: "100%", height: 288 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  {visible.map((p) => (
                    <linearGradient key={p} id={`grad-${p}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PLATFORM_META[p].color} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={PLATFORM_META[p].color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                  <linearGradient id="grad-total" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--ps-yellow)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--ps-yellow)" stopOpacity={0.03} />
                  </linearGradient>
                  {/* Horizontal stroke gradients: opaque through the boundary,
                      transparent after (and the inverse for the dashed overlay),
                      so ONE continuous curve renders solid then dashed. */}
                  {dashFrac !== null && [
                    ...visible.map((p) => ({ id: p as string, color: PLATFORM_META[p].color })),
                    { id: "total", color: "var(--ps-yellow)" },
                  ].flatMap(({ id, color }) => [
                    <linearGradient key={`stroke-${id}`} id={`stroke-${id}`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset={0} stopColor={color} stopOpacity={1} />
                      <stop offset={dashFrac} stopColor={color} stopOpacity={1} />
                      <stop offset={dashFrac} stopColor={color} stopOpacity={0} />
                      <stop offset={1} stopColor={color} stopOpacity={0} />
                    </linearGradient>,
                    <linearGradient key={`strokeDash-${id}`} id={`strokeDash-${id}`} x1="0" y1="0" x2="1" y2="0">
                      <stop offset={0} stopColor={color} stopOpacity={0} />
                      <stop offset={dashFrac} stopColor={color} stopOpacity={0} />
                      <stop offset={dashFrac} stopColor={color} stopOpacity={1} />
                      <stop offset={1} stopColor={color} stopOpacity={1} />
                    </linearGradient>,
                  ])}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-3)" strokeOpacity={0.25} vertical={false} />
                <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} width={42} />
                <Tooltip
                  cursor={{ stroke: "var(--surface-3)", strokeWidth: 1 }}
                  content={<ChartTooltip settlingFromStr={settlingFromStr} activeLabel={activeLabel} />}
                />
                {/* Overlaid (never stacked), each platform at its true value,
                    biggest behind. The settling tail is dashed via a SECOND copy
                    of the same curve with stroke gradients — one spline, no kink
                    where solid meets dashed. */}
                {(mode === "total"
                  ? [
                      <Area key="total" type="monotone" dataKey="total" stroke={dashFrac !== null ? "url(#stroke-total)" : "var(--ps-yellow)"} strokeWidth={2.5} fill="url(#grad-total)" connectNulls dot={false} />,
                      ...(dashFrac !== null ? [
                        <Area key="total-dash" type="monotone" dataKey="total" stroke="url(#strokeDash-total)" strokeWidth={2.5} strokeDasharray="5 4" fill="none" connectNulls dot={false} />,
                      ] : []),
                    ]
                  : renderOrder.flatMap((p) => {
                      const dim = hovered !== null && hovered !== p;
                      const color = PLATFORM_META[p].color;
                      return [
                        <Area key={p} type="monotone" dataKey={p} stroke={dashFrac !== null ? `url(#stroke-${p})` : color} strokeWidth={2.5} strokeOpacity={dim ? 0.18 : 1} fill={`url(#grad-${p})`} fillOpacity={dim ? 0.04 : 1} connectNulls dot={false} />,
                        ...(dashFrac !== null ? [
                          <Area key={`${p}-dash`} type="monotone" dataKey={p} stroke={`url(#strokeDash-${p})`} strokeWidth={2.5} strokeDasharray="5 4" strokeOpacity={dim ? 0.18 : 1} fill="none" connectNulls dot={false} />,
                        ] : []),
                      ];
                    }))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Breakdown — full-width table, spread columns, filled Total footer */}
        {contributors.length > 0 && (
          <div className="mt-5">
            <div className={"grid " + gridCls + " items-center gap-x-3 md:gap-x-6 px-4 pb-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--surface-3)]/40"}>
              <span>Platform</span>
              {isAbs ? (
                <>
                  <span className="text-right">Followers</span>
                  <span className="text-right">Gained</span>
                  <span className="text-right">Growth</span>
                </>
              ) : (
                <>
                  <span className="text-right">{activeLabel}</span>
                  <span className="text-right">Change</span>
                </>
              )}
            </div>
            {metric.breakdown.map((row) => {
              const p = row.platform;
              const on = !hidden.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(p)}
                  onMouseEnter={() => setHovered(p)}
                  onMouseLeave={() => setHovered(null)}
                  className={"w-full grid " + gridCls + " items-center gap-x-3 md:gap-x-6 px-4 py-3.5 border-b border-[var(--surface-3)]/15 transition-colors hover:bg-[var(--surface-2)]/40 " + (on ? "" : "opacity-40")}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="h-6 w-1.5 rounded-full shrink-0" style={{ background: on ? PLATFORM_META[p].color : "var(--surface-3)" }} />
                    <Logo platform={p} size={24} />
                    <span className={"text-[15px] truncate " + (on ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]")}>{PLATFORM_META[p].label}</span>
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums text-[var(--text-primary)] text-right">{fmtFull(row.total)}</span>
                  {isAbs ? (
                    <>
                      <span className="flex justify-end"><DeltaCount n={row.changeAbs} minW={gainedMinW} /></span>
                      <span className="flex justify-end"><DeltaPct pct={row.changePct} minW={pctMinW} /></span>
                    </>
                  ) : (
                    <span className="flex justify-end"><DeltaPct pct={row.changePct} minW={pctMinW} /></span>
                  )}
                </button>
              );
            })}
            {/* Total — filled footer bar (not floating border lines) */}
            <div className={"grid " + gridCls + " items-center gap-x-3 md:gap-x-6 px-4 py-3.5 mt-2 rounded-xl bg-[var(--surface-2)]/70"}>
              <span className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Total</span>
              <span className="text-[16px] font-bold tabular-nums text-[var(--text-primary)] text-right">{fmtFull(metric.total)}</span>
              {isAbs ? (
                <>
                  <span className="flex justify-end"><DeltaCount n={metric.changeAbs} minW={gainedMinW} /></span>
                  <span className="flex justify-end"><DeltaPct pct={metric.changePct} minW={pctMinW} /></span>
                </>
              ) : (
                <span className="flex justify-end"><DeltaPct pct={metric.changePct} minW={pctMinW} /></span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
