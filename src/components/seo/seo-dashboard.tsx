"use client";

/**
 * SEO dashboard.
 *
 * Search performance (Google ↔ Bing): 5 stat tiles drive a 28-day trend chart;
 * sortable + scrollable keyword/page tables (up to 100 rows, ~15 visible); GA4
 * website analytics (tiles + traffic donut + top landing pages); Bing AI
 * Performance (Copilot citations, fed by manual CSV); and a fixed 12-month
 * trend with its own metric boxes + straight regression trend line (always
 * last). Source logos label every data origin. Pure presentation off the live
 * read layer (lib/seo-data.ts).
 *
 * Motion (mirrors /socials so the two products read as one premium surface):
 *   - tile / feature-card numbers COUNT UP when the range changes (useCountUp);
 *     range changes arrive via router.refresh() — a SOFT refresh that reconciles
 *     (doesn't remount) this client tree — so the new totals tick instead of
 *     snapping;
 *   - the traffic donut shares the /socials hover-to-focus interaction (hovering
 *     a slice or legend row dims the rest + swaps the donut centre);
 *   - ranked-list bars grow in from zero; sections rise + fade on first paint;
 *   - tiles + cards lift with a brand-tinted sheen on hover.
 * recharts draw-in stays OFF (isAnimationActive=false) so the charts render
 * synchronously + deterministically (headless screenshots, no re-animate on
 * every metric toggle); the motion above carries the premium feel instead.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart, Area, ComposedChart, Line, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from "recharts";
import {
  MousePointerClick, Eye, Percent, Gauge, KeyRound, Search, FileText, Users,
  Clock, Sparkles, Globe, Info, CircleDashed, MapPin, type LucideIcon,
} from "lucide-react";
import type {
  SeoMock, SeoSource, SeoMetricKey, SourceData, DailyPoint, QueryRow, PageRow, LocalGrid,
} from "@/lib/seo-mock";
import { LocalSeoMap } from "./local-seo-map";
import { LocalSeoLocked } from "./local-seo-locked";

// ── formatters ──────────────────────────────────────────────────────────────
const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtIntRound = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtCompact = (n: number) =>
  Math.abs(n) >= 1_000 ? (n / 1_000).toFixed(1) + "K" : String(Math.round(n));
const fmtPct1 = (n: number) => n.toFixed(1) + "%";
const fmtPos = (n: number) => n.toFixed(1);
function fmtDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtMonth(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short" });
}
/** Shift a yyyy-MM-dd string by `delta` days (UTC, matches how days are stored). */
function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

// The freshest few days of Search Console data are still being revised by
// Google, so we render that trailing tail DASHED with a "may change" tooltip
// note (same treatment as /socials' settling window). The trend only dashes
// when the view actually reaches recent data (a historical range is all final).
const SETTLING_DAYS = 2;

// ── count-up animation ────────────────────────────────────────────────────────
// Cubic ease-out — fast start, gentle settle. Feels natural for counters.
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** Animate a numeric value from its previous render value to the new value with
 *  a cubic ease-out, returning the live frame value. Snaps on first mount (no
 *  0 → real flash), across null transitions, and under prefers-reduced-motion;
 *  a value change mid-flight re-targets from the current frame. Returns the raw
 *  number so the caller applies the SEO-specific formatter (CTR %, avg position,
 *  compact, …).
 *
 *  We react to a new `value` DURING RENDER (the React-endorsed "adjust state
 *  when a prop changes" pattern) rather than in an effect, so there's no
 *  setState-in-effect cascade; the effect only kicks off the rAF loop, and the
 *  per-frame setState lives in the async rAF callback. */
type Anim = { from: number | null; to: number | null };
function useCountUp(value: number | null, durationMs = 650): number | null {
  const [display, setDisplay] = useState<number | null>(value);
  // The active animation span. `to` doubles as the committed target; comparing
  // it to `value` during render is how we detect a new target without an effect.
  const [anim, setAnim] = useState<Anim>({ from: value, to: value });
  const rafRef = useRef<number | null>(null);

  if (value !== anim.to) {
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (value === null || display === null || reduce || value === display) {
      // Snap — no interpolation between these states.
      setAnim({ from: value, to: value });
      setDisplay(value);
    } else {
      // Animate from whatever frame is currently on screen (smooth re-target).
      setAnim({ from: display, to: value });
    }
  }

  useEffect(() => {
    const { from, to } = anim;
    if (from === null || to === null || from === to) return; // snap cases already committed display

    const t0 = performance.now();
    const stepFrame = (now: number) => {
      // max(0, …): the first rAF timestamp can be marginally < t0, which would
      // make the eased value dip just below `from` for one frame — clamp it out.
      const t = Math.max(0, Math.min(1, (now - t0) / durationMs));
      setDisplay(from + (to - from) * easeOutCubic(t));
      if (t < 1) rafRef.current = requestAnimationFrame(stepFrame);
      else rafRef.current = null;
    };
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(stepFrame);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [anim, durationMs]);

  return display;
}

/** Animated number — counts toward `value` and formats every frame. */
function CountUp({ value, format, className }: { value: number | null; format: (n: number) => string; className?: string }) {
  const d = useCountUp(value);
  return <span className={className}>{d === null ? "—" : format(d)}</span>;
}

// ── source badge (logo + label) ──────────────────────────────────────────────
const SOURCE_META: Record<"google" | "bing" | "ga4", { label: string; logo: string }> = {
  google: { label: "Search Console", logo: "/brand/sources/search-console.png" },
  bing: { label: "Bing Webmaster", logo: "/brand/sources/bing.png" },
  ga4: { label: "Google Analytics 4", logo: "/brand/sources/ga4.png" },
};
function SourceBadge({ source, label, size = 15 }: { source: "google" | "bing" | "ga4"; label?: string; size?: number }) {
  const m = SOURCE_META[source];
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)] min-w-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={m.logo} alt="" width={size} height={size} className="object-contain shrink-0" style={{ width: size, height: size }} />
      {/* Label hidden on mobile (icon alone identifies the source) — long names
          like "Search Console" / "Bing · Microsoft Copilot" overflow narrow
          section headers + table/list headers on a phone. */}
      <span className="hidden sm:inline truncate">{label ?? m.label}</span>
    </span>
  );
}

// ── delta badge (green/red; position inverts — lower is better) ───────────────
function DeltaBadge({ value, invert = false, format = "pct" }: { value: number | null; invert?: boolean; format?: "pct" | "count" }) {
  if (value === null || !isFinite(value)) return null;
  // Absolute-count delta (e.g. Keywords): a zero change reads as a neutral "±0",
  // not a coloured "↓ 0".
  if (format === "count" && Math.round(value) === 0) {
    return <span className="inline-flex items-center text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md text-[var(--text-tertiary)] bg-[var(--surface-3)]/40">±0</span>;
  }
  const good = invert ? value < 0 : value > 0;
  const up = value > 0;
  const text = format === "count" ? fmtInt(Math.abs(Math.round(value))) : Math.abs(value).toFixed(1) + "%";
  return (
    <span className={"inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md " +
      (good ? "text-[var(--positive)] bg-[var(--positive)]/10" : "text-[var(--negative)] bg-[var(--negative)]/10")}>
      {up ? "↑" : "↓"} {text}
    </span>
  );
}


/** Measure container width with a fallback so Recharts renders synchronously
 *  (ResponsiveContainer stays null under headless virtual-time). */
function useContainerWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth || fallback);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

// ── tooltip-info chip (metric icon ⇄ "i" morph + hover card) ──────────────────
/** The corner chip shared by every stat surface. The metric icon morphs to an
 *  "i" while the WHOLE TILE is hovered — driven by `group-hover` off the tile's
 *  `group` class (every StatTile / AiFeatureCard root is a `group`), mirroring
 *  /socials where the morph fires on `tileHover || chipHover`. The tooltip
 *  popover still opens only on the chip itself (`open`). */
function InfoChip({ icon: Icon, label, tip, size = 16 }: {
  icon: LucideIcon; label: string; tip: string; size?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex items-center justify-center shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="relative inline-flex items-center justify-center h-7 w-7 rounded-lg cursor-help text-[var(--accent-fg)] transition-colors duration-200 bg-[var(--surface-3)]/45 md:group-hover:bg-[var(--surface-3)]"
        aria-label={`${label}: ${tip}`}>
        {/* icon → "i" morph is desktop-only: on touch a tap triggers :hover, which
            flipped the chip to "i" with no tooltip behind it. */}
        <span aria-hidden className="absolute inset-0 flex items-center justify-center transition-all duration-200 opacity-100 scale-100 rotate-0 md:group-hover:opacity-0 md:group-hover:scale-50 md:group-hover:rotate-90"><Icon size={size} strokeWidth={2.25} /></span>
        <span aria-hidden className="absolute inset-0 hidden md:flex items-center justify-center transition-all duration-200 opacity-0 scale-50 -rotate-90 md:group-hover:opacity-100 md:group-hover:scale-100 md:group-hover:rotate-0"><Info size={size} strokeWidth={2.5} /></span>
      </span>
      {open && (
        <span className="hidden md:block absolute right-0 top-full z-30 w-60 pt-2 normal-case tracking-normal cursor-default">
          <span className="block p-2.5 rounded-md bg-[var(--surface-0)] border border-[var(--surface-3)] shadow-xl">
            <span className="block text-[11px] font-semibold text-[var(--text-primary)] mb-1">{label}</span>
            <span className="block text-[11px] text-[var(--text-secondary)] leading-snug">{tip}</span>
          </span>
        </span>
      )}
    </span>
  );
}

// ── stat tile ─────────────────────────────────────────────────────────────────
function StatTile({
  label, value, format, delta, invert, deltaFormat, icon, tip, active, onClick,
}: {
  label: string; value: number; format: (n: number) => string; delta?: number | null; invert?: boolean;
  deltaFormat?: "pct" | "count";
  icon: LucideIcon; tip: string; active?: boolean; onClick?: () => void;
}) {
  const Cmp = onClick ? "button" : "div";
  return (
    <Cmp
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={
        // Desktop only: tiles lift + sheen on hover and clickable ones carry the
        // yellow "active/selected" treatment. On MOBILE they're flat static stats
        // — the trend chart they'd drive is hidden there, so there's nothing to
        // select and no hover; all the active/hover styling is md:-gated.
        "group relative text-left rounded-[var(--radius-card)] p-4 flex flex-col gap-2.5 bg-[var(--surface-1)] border border-[var(--surface-3)]/40 transition-all duration-200 ease-out will-change-transform " +
        (active
          ? "md:z-20 md:-translate-y-0.5 md:border-[var(--ps-yellow)] md:ring-1 md:ring-[var(--ps-yellow)]/40 md:shadow-lg md:shadow-[var(--ps-yellow)]/10"
          : "md:z-0 md:hover:z-20 md:hover:-translate-y-0.5 md:hover:border-[var(--surface-3)] md:hover:shadow-lg md:hover:shadow-black/20")
      }
    >
      <span aria-hidden
        className={"pointer-events-none absolute inset-0 rounded-[var(--radius-card)] transition-opacity duration-300 " + (active ? "opacity-0 md:opacity-100" : "opacity-0 md:group-hover:opacity-100")}
        style={{ background: "radial-gradient(120% 80% at 0% 0%, rgba(255,209,0,0.10), transparent 60%)" }} />
      <div className="relative flex items-center justify-between gap-1.5">
        <span className={"text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.1em] truncate transition-colors text-[var(--text-secondary)] " + (active ? "md:text-[var(--text-primary)]" : "")}>{label}</span>
        <InfoChip icon={icon} label={label} tip={tip} />
      </div>
      {/* nowrap + smaller mobile value so a 6-digit number and its delta badge
          stay on ONE line in a narrow 2-up tile (the % was wrapping below). */}
      <div className="relative flex flex-nowrap items-center gap-1.5 sm:gap-2">
        <CountUp value={value} format={format}
          className={"text-[17px] sm:text-[22px] lg:text-[25px] leading-none font-bold tabular-nums tracking-tight whitespace-nowrap transition-colors duration-200 text-[var(--text-primary)] " +
            (active ? "md:[text-shadow:0_0_18px_rgba(255,209,0,0.25)]" : "md:text-[var(--text-secondary)] md:group-hover:text-[var(--text-primary)]")} />
        {delta !== undefined && <span className="shrink-0"><DeltaBadge value={delta ?? null} invert={invert} format={deltaFormat} /></span>}
      </div>
    </Cmp>
  );
}

// ── search metric definitions ─────────────────────────────────────────────────
const SEARCH_METRICS: Array<{
  key: SeoMetricKey; label: string; icon: LucideIcon; tip: string;
  num: (t: SourceData["totals"]) => number; vfmt: (n: number) => string; invert?: boolean;
  /** "count" renders the delta as an absolute ± figure (Keywords) instead of a %. */
  deltaFormat?: "count";
}> = [
  { key: "clicks", label: "Clicks", icon: MousePointerClick, num: (t) => t.clicks, vfmt: fmtIntRound, tip: "Times someone clicked through to the site from search results during the period." },
  { key: "impressions", label: "Impressions", icon: Eye, num: (t) => t.impressions, vfmt: fmtIntRound, tip: "Times the site appeared in search results during the period — repeat views included." },
  { key: "keywords", label: "Keywords", icon: KeyRound, num: (t) => t.keywords, vfmt: fmtIntRound, deltaFormat: "count", tip: "Distinct search terms you rank for, as of the latest complete day (Google data lags ~2–3 days). The badge is the change vs the matching day in the comparison period." },
  { key: "ctr", label: "CTR", icon: Percent, num: (t) => t.ctr, vfmt: fmtPct1, tip: "Click-through rate — clicks divided by impressions." },
  { key: "position", label: "Avg position", icon: Gauge, num: (t) => t.position, vfmt: fmtPos, invert: true, tip: "Average ranking position across all queries — lower is better (1 = top of page one)." },
];

/** Chartable search metrics. Keywords is back as a first-class metric: the ETL
 *  now paginates the FULL GSC date×query export into seo_query_daily, so the
 *  per-day distinct count is accurate (no longer skewed by the ~25k row cap) and
 *  the period tile is an exact COUNT(DISTINCT query) over the selected range. */
const CHART_METRICS: SeoMetricKey[] = ["clicks", "impressions", "keywords", "ctr", "position"];

// Chartable metric: a Google search metric, OR the opt-in website Leads count
// (merged onto the same DailyPoint series so the chart machinery is reused).
type ChartMetric = SeoMetricKey | "leads";
function metricValue(p: DailyPoint, key: ChartMetric): number {
  if (key === "ctr") return +((p.clicks / Math.max(1, p.impressions)) * 100).toFixed(2);
  if (key === "position") return p.position;
  if (key === "keywords") return p.keywords;
  if (key === "leads") return p.leads ?? 0;
  return p[key];
}
const yAxisFmt = (metric: ChartMetric) =>
  metric === "ctr" ? (v: number) => v + "%"
  : metric === "position" ? (v: number) => String(v)
  : fmtCompact;
const valueText = (metric: ChartMetric, v: number | undefined) =>
  v == null ? "—"
  : metric === "ctr" ? v.toFixed(1) + "%"
  : metric === "position" ? v.toFixed(1)
  : fmtInt(Math.round(v));

// Each source scales to its OWN data (per-platform, auto). For Avg position the
// axis is reversed (1 = top) and the area fills DOWNWARD from the line via
// baseValue = the domain max, so the yellow gradient sits on the lower side.
type ChartScale = { domain: [number, number] | undefined; baseValue?: number };
function chartScale(s: DailyPoint[], metric: ChartMetric): ChartScale {
  if (metric === "position") {
    let max = 0;
    for (const p of s) max = Math.max(max, p.position);
    const hi = Math.max(10, Math.ceil(max / 5) * 5);
    return { domain: [1, hi], baseValue: hi };
  }
  return { domain: undefined };
}

// ── chart tooltips ────────────────────────────────────────────────────────────
function ChartTip({ active, payload, label, metric, settlingFromDay }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string; metric: ChartMetric; settlingFromDay?: string | null }) {
  if (!active || !payload?.length) return null;
  const day = String(label);
  const settling = !!settlingFromDay && day >= settlingFromDay;
  return (
    <div className="rounded-lg border border-[var(--surface-3)] bg-[var(--surface-0)] px-3 py-2 text-[12px] shadow-xl">
      <div className="mb-0.5 text-[var(--text-secondary)]">{fmtDay(day)}</div>
      <div className="font-semibold text-[var(--text-primary)] tabular-nums">{valueText(metric, payload[0].value)}</div>
      {settling && (
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-[var(--surface-3)]/50 pt-1.5 text-[11px] text-[var(--accent-fg)]">
          <CircleDashed size={12} strokeWidth={2.25} /> Not final — Google may still revise this
        </div>
      )}
    </div>
  );
}
function YearTip({ active, payload, label, metric }: { active?: boolean; payload?: Array<{ value?: number; dataKey?: string | number }>; label?: string; metric: SeoMetricKey }) {
  if (!active || !payload?.length) return null;
  const v = payload.find((p) => p.dataKey === "value")?.value;
  const trend = payload.find((p) => p.dataKey === "trend")?.value;
  return (
    <div className="rounded-lg border border-[var(--surface-3)] bg-[var(--surface-0)] px-3 py-2 text-[12px] shadow-xl">
      <div className="mb-1 text-[var(--text-secondary)]">{fmtDay(String(label))}</div>
      <div className="flex items-center justify-between gap-4 tabular-nums"><span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--ps-yellow)" }} />Daily</span><span className="font-semibold text-[var(--text-primary)]">{valueText(metric, v)}</span></div>
      <div className="flex items-center justify-between gap-4 tabular-nums"><span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--chart-2)" }} />Trend</span><span className="font-semibold text-[var(--text-primary)]">{valueText(metric, trend)}</span></div>
    </div>
  );
}
function AiTip({ active, payload, label, dataStart, dataEnd }: { active?: boolean; payload?: Array<{ value?: number }>; label?: string; dataStart?: string | null; dataEnd?: string | null }) {
  if (!active || !payload?.length) return null;
  const day = String(label);
  const noData = !dataStart || !dataEnd || day < dataStart || day > dataEnd;
  return (
    <div className="rounded-lg border border-[var(--surface-3)] bg-[var(--surface-0)] px-3 py-2 text-[12px] shadow-xl">
      <div className="mb-0.5 text-[var(--text-secondary)]">{fmtDay(day)}</div>
      {noData ? (
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]"><CircleDashed size={12} strokeWidth={2.25} /> No AI data for this day yet</div>
      ) : (
        <div className="font-semibold text-[var(--text-primary)] tabular-nums">{fmtInt(payload[0].value ?? 0)} citations</div>
      )}
    </div>
  );
}

// ── 28-day trend ───────────────────────────────────────────────────────────────
function TrendChart({ series, metric, scale, dataEndDay, ai }: {
  series: DailyPoint[]; metric: ChartMetric | "aiCitations"; scale: ChartScale; dataEndDay?: string;
  ai?: { series: { day: string; citations: number }[]; dataStart: string | null; dataEnd: string | null };
}) {
  // ONE chart for every top metric (incl. AI citations) so switching tiles
  // MORPHS the path (Recharts animates same-component data changes) instead of
  // remounting + redrawing from scratch.
  const isAi = metric === "aiCitations";
  const data = useMemo(
    () => (isAi && ai
      ? ai.series.map((p) => ({ day: p.day, value: p.citations }))
      : series.map((p) => ({ day: p.day, value: metricValue(p, metric as ChartMetric) }))),
    [isAi, ai, series, metric],
  );
  const [ref, width] = useContainerWidth(960);

  // Google: freshest SETTLING_DAYS still revisable → dashed tail (recent ranges only).
  const settlingFromDay = useMemo(() => {
    if (isAi || !dataEndDay || data.length < 2) return null;
    const last = data[data.length - 1].day;
    if (last < shiftDay(dataEndDay, -7)) return null;
    return data[Math.max(0, data.length - SETTLING_DAYS)].day;
  }, [data, dataEndDay, isAi]);

  // Solid x-range [from,to] (fractions); OUTSIDE renders dashed. Google: solid
  // [0, settling] + dashed tail. AI: solid over the uploaded span + dashed
  // (0-padded) on the no-data days.
  const solid = useMemo(() => {
    const n = data.length;
    if (n < 2) return { from: 0, to: 1 };
    if (isAi) {
      if (!ai || !ai.dataStart || !ai.dataEnd) return { from: 1, to: 1 }; // no data → all dashed at 0
      const i0 = Math.max(0, data.findIndex((d) => d.day >= ai.dataStart!));
      let i1 = data.findIndex((d) => d.day >= ai.dataEnd!);
      if (i1 < 0) i1 = n - 1;
      return { from: i0 / (n - 1), to: i1 / (n - 1) };
    }
    if (!settlingFromDay) return { from: 0, to: 1 };
    const idx = data.findIndex((d) => d.day >= settlingFromDay);
    return idx < 0 ? { from: 0, to: 1 } : { from: 0, to: idx / (n - 1) };
  }, [data, isAi, ai, settlingFromDay]);
  const split = solid.from > 0 || solid.to < 1;

  return (
    <div ref={ref} style={{ width: "100%", height: 268, overflow: "hidden" }}>
      <AreaChart width={width} height={268} data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="seo-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ps-yellow)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--ps-yellow)" stopOpacity={0.03} />
          </linearGradient>
          {/* Horizontal stroke gradients: opaque only across [from,to] (solid),
              transparent outside — and the inverse for the dashed overlay — so ONE
              continuous curve renders solid then dashed with no seam. */}
          {split && (
            <>
              <linearGradient id="seo-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset={0} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={solid.from} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={solid.from} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={solid.to} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={solid.to} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={1} stopColor="var(--ps-yellow)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="seo-stroke-dash" x1="0" y1="0" x2="1" y2="0">
                <stop offset={0} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={solid.from} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={solid.from} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={solid.to} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={solid.to} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={1} stopColor="var(--ps-yellow)" stopOpacity={1} />
              </linearGradient>
            </>
          )}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-3)" strokeOpacity={0.25} vertical={false} />
        <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis reversed={!isAi && metric === "position"} tickFormatter={yAxisFmt(isAi ? "clicks" : (metric as ChartMetric))} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} width={42} domain={scale.domain} />
        <Tooltip cursor={{ stroke: "var(--ps-yellow)", strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.5 }} content={isAi ? <AiTip dataStart={ai?.dataStart} dataEnd={ai?.dataEnd} /> : <ChartTip metric={metric as ChartMetric} settlingFromDay={settlingFromDay} />} />
        <Area type="monotone" dataKey="value" baseValue={scale.baseValue} stroke={split ? "url(#seo-stroke)" : "var(--ps-yellow)"} strokeWidth={2.5} fill="url(#seo-grad)" dot={false}
          activeDot={{ r: 5, fill: "var(--ps-yellow)", stroke: "var(--surface-0)", strokeWidth: 2 }}
          isAnimationActive animationDuration={850} animationEasing="ease-out" />
        {split && (
          <Area type="monotone" dataKey="value" baseValue={scale.baseValue} stroke="url(#seo-stroke-dash)" strokeWidth={2.5} strokeDasharray="5 4" fill="none" dot={false}
            isAnimationActive animationDuration={850} animationEasing="ease-out" />
        )}
      </AreaChart>
    </div>
  );
}

// ── 12-month trend (straight regression trend + dashed mean) ───────────────────
function YearChart({ series, metric, scale }: { series: DailyPoint[]; metric: SeoMetricKey; scale: ChartScale }) {
  const [ref, width] = useContainerWidth(1040);
  const { data, mean } = useMemo(() => {
    const vals = series.map((p) => metricValue(p, metric));
    const n = vals.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += vals[i]; sxx += i * i; sxy += i * vals[i]; }
    const denom = n * sxx - sx * sx;
    const b = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    const a = (sy - b * sx) / Math.max(1, n);
    const mean = +(sy / Math.max(1, n)).toFixed(2);
    // Clamp the regression line at 0 — a count (clicks / impressions / keywords)
    // can't go negative, so the extrapolated trend must not dip below the axis.
    return { data: series.map((p, i) => ({ day: p.day, value: vals[i], trend: Math.max(0, +(a + b * i).toFixed(2)) })), mean };
  }, [series, metric]);
  return (
    <div ref={ref} style={{ width: "100%", height: 280, overflow: "hidden" }}>
      <ComposedChart width={width} height={280} data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="seo-year-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ps-yellow)" stopOpacity={0.2} />
            <stop offset="100%" stopColor="var(--ps-yellow)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-3)" strokeOpacity={0.25} vertical={false} />
        <XAxis dataKey="day" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} minTickGap={46} />
        <YAxis reversed={metric === "position"} tickFormatter={yAxisFmt(metric)} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} width={42} domain={scale.domain} />
        <Tooltip cursor={{ stroke: "var(--ps-yellow)", strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.5 }} content={<YearTip metric={metric} />} />
        <ReferenceLine y={mean} stroke="var(--text-secondary)" strokeDasharray="6 5" strokeOpacity={0.7} label={{ value: `avg ${valueText(metric, mean)}`, position: "insideTopRight", fill: "var(--text-tertiary)", fontSize: 11 }} />
        <Area type="monotone" dataKey="value" baseValue={scale.baseValue} stroke="var(--ps-yellow)" strokeWidth={1.5} strokeOpacity={0.5} fill="url(#seo-year-grad)" dot={false}
          activeDot={{ r: 4, fill: "var(--ps-yellow)", stroke: "var(--surface-0)", strokeWidth: 2 }}
          isAnimationActive animationDuration={900} animationEasing="ease-out" />
        <Line type="linear" dataKey="trend" stroke="var(--chart-2)" strokeWidth={2.5} dot={false} isAnimationActive animationBegin={250} animationDuration={750} animationEasing="ease-out" />
      </ComposedChart>
    </div>
  );
}

// ── sortable + scrollable search table (queries / pages, up to 100 rows) ───────
type SortKey = "clicks" | "impressions" | "ctr" | "position";

// Rank-band dot for the Position column (lower rank = better → green).
function posColor(pos: number): string {
  if (pos <= 3) return "var(--positive)";
  if (pos <= 10) return "var(--warning)";
  return "var(--text-tertiary)";
}

function SearchTable<T extends QueryRow | PageRow>({
  title, icon: Icon, source, rows, firstHeader, firstValue, showPosition = false,
}: {
  title: string; icon: LucideIcon; source: SeoSource; rows: T[];
  firstHeader: string; firstValue: (r: T) => string;
  // Keywords keep the Position (avg rank) column; Top pages drop it — only the
  // keyword list is where rank-per-row is actually useful.
  showPosition?: boolean;
}) {
  const cols: Array<{ key: SortKey; label: string }> = [
    { key: "clicks", label: "Clicks" },
    { key: "impressions", label: "Impr." },
    { key: "ctr", label: "CTR" },
    ...(showPosition ? [{ key: "position" as const, label: "Position" }] : []),
  ];
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "impressions", dir: "desc" });
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => (sort.dir === "desc" ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]));
    return arr;
  }, [rows, sort]);
  // Position is "better when lower", so it defaults to ascending; volume metrics default desc.
  const clickCol = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "position" ? "asc" : "desc" }));

  // Metric columns. Mobile shows #, query/page, Clicks + Impressions; CTR (and
  // Position, when present) fold in at md. No sideways scroll on a phone.
  const grid = showPosition
    ? "grid-cols-[26px_minmax(0,1fr)_0.9fr_0.9fr] md:grid-cols-[34px_minmax(0,2.4fr)_0.9fr_0.9fr_0.8fr_0.9fr]"
    : "grid-cols-[26px_minmax(0,1fr)_0.9fr_0.9fr] md:grid-cols-[34px_minmax(0,2.4fr)_0.9fr_0.9fr_0.8fr]";
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 flex flex-col transition-colors duration-200 hover:border-[var(--surface-3)]/70">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-[var(--surface-3)]/45 text-[var(--accent-fg)]"><Icon size={15} strokeWidth={2.25} /></span>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          <span className="text-[12px] text-[var(--text-tertiary)]">{rows.length} total</span>
        </div>
        <SourceBadge source={source} />
      </div>

      {/* overflow-auto (not just -y): on a narrow screen the 6-column grid can't
          shrink below its labels, so let it scroll sideways via the min-width
          wrapper instead of crushing the headers into each other. */}
      {/* ~10 rows visible on mobile (scroll for the rest), ~15 on desktop. */}
      <div className="max-h-[444px] md:max-h-[604px] overflow-auto rounded-lg border border-[var(--surface-3)]/30">
        <div className="md:min-w-[480px]">
        {/* header (sticky within the scroll area, click a metric to sort) */}
        <div className={"sticky top-0 z-[1] grid " + grid + " items-center gap-x-4 px-3 py-2.5 bg-[var(--surface-2)] border-b border-[var(--surface-3)]/50 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]"}>
          <span className="text-right pr-1">#</span>
          <span>{firstHeader}</span>
          {cols.map((c) => {
            const on = sort.key === c.key;
            // On mobile keep #, query/page, Clicks, Impr — fold CTR + Position away.
            const hideMobile = c.key === "ctr" || c.key === "position";
            return (
              <button key={c.key} type="button" onClick={() => clickCol(c.key)}
                className={(hideMobile ? "hidden md:flex " : "flex ") + "items-center justify-end gap-1 uppercase tracking-wider transition-colors " + (on ? "text-[var(--accent-fg)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]")}>
                {c.label}{on ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
              </button>
            );
          })}
        </div>
        {sorted.length === 0 && (
          <div className="px-3 py-12 text-center text-[13px] text-[var(--text-tertiary)]">No rows for this period.</div>
        )}
        {sorted.map((r, i) => (
          <div key={i} className={"group/row grid " + grid + " items-center gap-x-4 px-3 py-2.5 border-b border-[var(--surface-3)]/12 transition-colors hover:bg-[var(--surface-2)]/50"}>
            <span className="text-right pr-1 text-[12px] tabular-nums text-[var(--text-tertiary)] transition-colors group-hover/row:text-[var(--accent-fg)]">{i + 1}</span>
            <span className="min-w-0 text-[14px] text-[var(--text-primary)] truncate">{firstValue(r)}</span>
            <span className={"text-right text-[14px] tabular-nums " + (sort.key === "clicks" ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>{fmtInt(r.clicks)}</span>
            <span className={"text-right text-[14px] tabular-nums " + (sort.key === "impressions" ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>{fmtInt(r.impressions)}</span>
            <span className={"hidden md:block text-right text-[14px] tabular-nums " + (sort.key === "ctr" ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>{r.ctr.toFixed(1)}%</span>
            {showPosition && (
              <span className={"hidden md:flex items-center justify-end gap-1.5 text-[14px] tabular-nums " + (sort.key === "position" ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]")}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: posColor(r.position) }} />
                {r.position.toFixed(1)}
              </span>
            )}
          </div>
        ))}
        </div>
      </div>
    </section>
  );
}

// ── ranked list (premium slim bars, scrollable, grow-in) ───────────────────────
function RankedList({ title, sub, icon: Icon, source, items, valueFmt }: {
  title: string; sub: string; icon: LucideIcon; source?: "google" | "bing" | "ga4";
  items: { label: string; value: number }[]; valueFmt: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 flex flex-col transition-colors duration-200 hover:border-[var(--surface-3)]/70">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-[var(--surface-3)]/45 text-[var(--accent-fg)]"><Icon size={15} strokeWidth={2.25} /></span>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          <span className="text-[12px] text-[var(--text-tertiary)]">{sub}</span>
        </div>
        {source && <SourceBadge source={source} />}
      </div>
      {items.length === 0 ? (
        <div className="flex-1 min-h-[120px] flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
          No data for this period.
        </div>
      ) : (
        <ul className="flex flex-col gap-1 max-h-[420px] overflow-y-auto pr-1">
          {items.map((it, i) => (
            <li key={i} className="group/row px-2 py-2 rounded-md hover:bg-[var(--surface-2)]/40 transition-colors">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className="min-w-0 truncate text-[13.5px] text-[var(--text-secondary)] transition-colors group-hover/row:text-[var(--text-primary)]">{it.label}</span>
                <span className="tabular-nums text-[14px] font-semibold text-[var(--text-primary)] shrink-0">{valueFmt(it.value)}</span>
              </div>
              <div className="h-1 rounded-full bg-[var(--surface-3)]/40 overflow-hidden">
                {/* width = the real value (full at rest / SSR / reduced-motion); the
                    ps-bar-grow scaleX animation only sweeps it out on mount. */}
                <div
                  className="ps-bar-grow h-full rounded-full bg-[var(--ps-yellow)] opacity-80 transition-opacity duration-200 group-hover/row:opacity-100"
                  style={{ width: `${(it.value / max) * 100}%`, animationDelay: `${Math.min(i, 12) * 30}ms` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── GA4 traffic-source donut (side-by-side, hover-to-focus) ────────────────────
// Theme-aware ramp via CSS vars (resolve live on theme flip, no JS/flash). We
// only ever use the FRONT of it (brand yellow → near-black/off-white → mid-grey),
// which holds contrast on BOTH the white and dark cards — the pale tail
// (--chart-5/6) is avoided by rolling small channels into one "Other" slice.
const CHANNEL_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
// Channels below this share of total sessions collapse into a single "Other".
const ROLLUP_THRESHOLD = 0.03;

function TrafficSourcesCard({ channels }: { channels: SeoMock["ga4"]["channels"] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Sort desc, then fold everything under 3% into one "Other" bucket so the donut
  // never shows near-invisible slivers (the thing that read as "white on white").
  const { data, rolledUpNames } = useMemo(() => {
    const live = [...channels].filter((c) => c.sessions > 0).sort((a, b) => b.sessions - a.sessions);
    const grand = live.reduce((a, c) => a + c.sessions, 0);
    const kept: { name: string; sessions: number; isOther?: boolean }[] = [];
    const small: { name: string; sessions: number }[] = [];
    for (const c of live) {
      if (grand > 0 && c.sessions / grand < ROLLUP_THRESHOLD) small.push({ name: c.name, sessions: c.sessions });
      else kept.push({ name: c.name, sessions: c.sessions });
    }
    if (small.length > 0) {
      kept.push({ name: "Other", sessions: small.reduce((a, c) => a + c.sessions, 0), isOther: true });
    }
    return { data: kept, rolledUpNames: small.map((c) => c.name) };
  }, [channels]);
  const total = data.reduce((a, c) => a + c.sessions, 0);
  const hovered = hover !== null ? data[hover] : null;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const fmtPctOf = (n: number) => {
    const p = pct(n);
    return p >= 10 || p === 0 ? `${Math.round(p)}%` : `${p.toFixed(1)}%`;
  };

  // Measure the donut column and size a SQUARE pie to it (synchronous render,
  // no ResponsiveContainer). Capped so it stays balanced beside the legend.
  const [ref, w] = useContainerWidth(232);
  const size = Math.max(168, Math.min(248, w));
  const outer = Math.round(size * 0.47);
  const inner = Math.round(size * 0.305);

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 sm:p-6 flex flex-col transition-colors duration-200 hover:border-[var(--surface-3)]/70">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Traffic sources</h2>
        <SourceBadge source="ga4" />
      </div>
      <p className="text-[12px] text-[var(--text-tertiary)] mb-4">Where your visitors come from</p>

      {total === 0 ? (
        <div className="flex-1 min-h-[200px] flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
          No sessions in this period.
        </div>
      ) : (
        <div
          className="flex flex-1 flex-col justify-center gap-6 md:grid md:grid-cols-[1.05fr_1fr] md:gap-7 md:items-center"
          onMouseLeave={() => setHover(null)}
        >
          {/* Donut + centre label — desktop only (no graphs on mobile; the
              ranked legend below carries the numbers). */}
          <div ref={ref} className="hidden md:flex w-full items-center justify-center">
            <div className="relative" style={{ width: size, height: size }}>
              <PieChart width={size} height={size}>
                <Pie data={data} dataKey="sessions" nameKey="name" cx="50%" cy="50%"
                  innerRadius={inner} outerRadius={outer} paddingAngle={2}
                  stroke="var(--surface-1)" strokeWidth={2} isAnimationActive={false}
                  onMouseEnter={(_, idx) => setHover(idx)} onMouseLeave={() => setHover(null)}>
                  {data.map((c, i) => (
                    <Cell key={c.name} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]}
                      fillOpacity={hover === null || hover === i ? 1 : 0.32}
                      style={{ cursor: "pointer", transition: "fill-opacity 150ms ease" }} />
                  ))}
                </Pie>
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-4">
                <span className="text-[26px] sm:text-[30px] font-bold tabular-nums leading-none text-[var(--text-primary)]">{fmtInt(hovered ? hovered.sessions : total)}</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] mt-1.5 max-w-full truncate">{hovered ? `${fmtPctOf(hovered.sessions)} of sessions` : "Sessions"}</span>
              </div>
            </div>
          </div>

          {/* Ranked legend — to the RIGHT of the donut on md+, stacked on mobile */}
          <ul className="flex flex-col divide-y divide-[var(--surface-3)]/40" onMouseLeave={() => setHover(null)}>
            {data.map((c, i) => {
              const dim = hover !== null && hover !== i;
              return (
                <li key={c.name} onMouseEnter={() => setHover(i)}
                  title={c.isOther && rolledUpNames.length ? `Other: ${rolledUpNames.join(", ")}` : undefined}
                  className={"grid grid-cols-[14px_1fr_auto_auto] items-center gap-2.5 py-2 px-2 -mx-2 rounded-md cursor-default transition-colors " + (hover === i ? "bg-[var(--surface-2)]" : "")}>
                  <span className="inline-block h-2.5 w-2.5 rounded-full transition-opacity" style={{ background: CHANNEL_COLORS[i % CHANNEL_COLORS.length], opacity: dim ? 0.4 : 1 }} />
                  <span className={"text-[13px] min-w-0 truncate transition-colors " + (dim ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]")}>{c.name}</span>
                  <span className={"text-[13px] font-semibold tabular-nums transition-colors " + (dim ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]")}>{fmtInt(c.sessions)}</span>
                  <span className="text-[11px] tabular-nums text-[var(--text-tertiary)] w-10 text-right">{fmtPctOf(c.sessions)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── AI feature card (rich, filled — icon chip + big number + watermark) ────────
/** The two AI-Performance headline metrics. Unlike the compact StatTiles, these
 *  fill their box: identity chip + label up top, an oversized count-up number +
 *  caption anchored to the bottom, a faded brand watermark bleeding off the
 *  corner, and a light sweep + lift on hover — so the column beside the chart
 *  reads as intentional, not empty. */
function AiFeatureCard({ icon: Icon, label, value, format, delta, invert, caption, tip }: {
  icon: LucideIcon; label: string; value: number; format: (n: number) => string;
  delta?: number | null; invert?: boolean; caption: string; tip: string;
}) {
  return (
    <div className="group relative flex-1 overflow-hidden rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-5 flex flex-col justify-between gap-5 min-h-[156px] transition-all duration-300 ease-out will-change-transform hover:-translate-y-0.5 hover:border-[var(--surface-3)] hover:shadow-xl hover:shadow-black/20">
      {/* brand sheen, fades in on hover (clipped to the card radius) */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[var(--radius-card)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: "radial-gradient(120% 80% at 0% 0%, rgba(255,209,0,0.09), transparent 60%)" }} />
      {/* oversized faded watermark glyph bleeding off the bottom-right — drifts + grows
          on hover. --accent-fg = brand yellow on dark, near-black ink on light, so the
          glyph reads as a faint watermark on BOTH themes (a flat yellow would vanish on white). */}
      <span aria-hidden className="pointer-events-none absolute -right-4 -bottom-7 text-[var(--accent-fg)] opacity-[0.07] transition-all duration-500 ease-out group-hover:scale-110 group-hover:-translate-x-1.5 group-hover:opacity-[0.12]">
        <Icon size={138} strokeWidth={1.5} />
      </span>
      {/* light sweep on hover — theme-aware (--sweep is a faint white on dark, faint dark
          on light) so the sweep reads on the white card too, not just on dark. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 ease-out group-hover:translate-x-full" style={{ background: "linear-gradient(105deg, transparent, var(--sweep), transparent)" }} />

      {/* Title row. On mobile the cards sit 2-up (narrow) and the icon chip +
          info chip squeezed the label out of view — so on mobile we drop both
          (the big watermark glyph already carries the icon) and center the label.
          Desktop keeps the chip + info button. */}
      <div className="relative flex items-center justify-center md:justify-between gap-2">
        <span className="flex items-center justify-center md:justify-start gap-2.5 min-w-0">
          <span className="hidden md:inline-flex items-center justify-center h-9 w-9 rounded-xl bg-[var(--surface-3)]/45 text-[var(--accent-fg)] shrink-0"><Icon size={18} strokeWidth={2.25} /></span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)] truncate text-center md:text-left">{label}</span>
        </span>
        <span className="hidden md:block"><InfoChip icon={Icon} label={label} tip={tip} /></span>
      </div>

      {/* Number + caption — centered on mobile (under the centered title), left
          on desktop. */}
      <div className="relative flex flex-col items-center md:items-start gap-1 text-center md:text-left">
        <div className="flex items-end gap-2.5">
          <CountUp value={value} format={format} className="text-[34px] sm:text-[38px] font-bold leading-[0.95] tabular-nums tracking-tight text-[var(--text-primary)]" />
          {delta !== undefined && <DeltaBadge value={delta ?? null} invert={invert} />}
        </div>
        <span className="text-[12px] text-[var(--text-tertiary)]">{caption}</span>
      </div>
    </div>
  );
}

// ── AI citations mini-chart ─────────────────────────────────────────────────────
function AiCitationsChart({ series, dataStart, dataEnd, height = 196 }: { series: SeoMock["ai"]["series"]; dataStart?: string | null; dataEnd?: string | null; height?: number }) {
  const [ref, width] = useContainerWidth(620);
  const n = series.length;
  // Solid line + area over the real-data span [dataStart, dataEnd] (looks like
  // the other charts); the 0-padded no-data days render DASHED — same trick as
  // the GSC settling tail, but here it means "no AI data uploaded for these days
  // yet" (the tooltip says so). One continuous line via horizontal stroke gradients.
  const { f0, f1, split } = useMemo(() => {
    if (n < 2) return { f0: 0, f1: 1, split: false };
    if (!dataStart || !dataEnd) return { f0: 1, f1: 1, split: true }; // no data in range → all dashed at 0
    const i0 = Math.max(0, series.findIndex((d) => d.day >= dataStart));
    let i1 = series.findIndex((d) => d.day >= dataEnd);
    if (i1 < 0) i1 = n - 1;
    return { f0: i0 / (n - 1), f1: i1 / (n - 1), split: i0 > 0 || i1 < n - 1 };
  }, [series, dataStart, dataEnd, n]);
  return (
    <div ref={ref} style={{ width: "100%", height, overflow: "hidden" }}>
      <AreaChart width={width} height={height} data={series} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="ai-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ps-yellow)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--ps-yellow)" stopOpacity={0.03} />
          </linearGradient>
          {split && (
            <>
              <linearGradient id="ai-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset={0} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={f0} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={f0} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={f1} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={f1} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={1} stopColor="var(--ps-yellow)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="ai-stroke-dash" x1="0" y1="0" x2="1" y2="0">
                <stop offset={0} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={f0} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={f0} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={f1} stopColor="var(--ps-yellow)" stopOpacity={0} />
                <stop offset={f1} stopColor="var(--ps-yellow)" stopOpacity={1} />
                <stop offset={1} stopColor="var(--ps-yellow)" stopOpacity={1} />
              </linearGradient>
            </>
          )}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-3)" strokeOpacity={0.25} vertical={false} />
        <XAxis dataKey="day" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} width={36} />
        <Tooltip cursor={{ stroke: "var(--ps-yellow)", strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.5 }} content={<AiTip dataStart={dataStart} dataEnd={dataEnd} />} />
        {/* Solid line + yellow area, exactly like the search charts. */}
        <Area type="monotone" dataKey="citations" stroke={split ? "url(#ai-stroke)" : "var(--ps-yellow)"} strokeWidth={2.5} fill="url(#ai-grad)" dot={false}
          activeDot={{ r: 5, fill: "var(--ps-yellow)", stroke: "var(--surface-0)", strokeWidth: 2 }}
          isAnimationActive animationDuration={850} animationEasing="ease-out" />
        {/* Dashed overlay only across the no-data (0-padded) stretches. */}
        {split && (
          <Area type="monotone" dataKey="citations" stroke="url(#ai-stroke-dash)" strokeWidth={2.5} strokeDasharray="5 4" fill="none" dot={false} isAnimationActive animationDuration={850} animationEasing="ease-out" />
        )}
      </AreaChart>
    </div>
  );
}

// ── section heading ─────────────────────────────────────────────────────────────
function SectionHead({ title, sub, right }: { title: string; sub: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h1>
        {sub}
      </div>
      {right}
    </div>
  );
}
function Dot() {
  return <span className="text-[var(--text-tertiary)]">·</span>;
}
function Period({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] text-[var(--text-tertiary)]">{children}</span>;
}

// ── main ──────────────────────────────────────────────────────────────────────
export function SeoDashboard({ data, picker, showLocalSeo = false, dataEndStr, clientId }: { data: SeoMock; picker?: React.ReactNode; showLocalSeo?: boolean; dataEndStr?: string; clientId: string }) {
  // Top chart metric: a Google search metric OR AI citations (its own CSV-fed
  // data source). Keywords drops from the top row → lives only in 12-month.
  const [metric, setMetric] = useState<ChartMetric | "aiCitations">("clicks");
  const [yearMetric, setYearMetric] = useState<SeoMetricKey>("clicks");
  const sd = data.google;

  const isAi = metric === "aiCitations";
  const gMetric: ChartMetric = isAi ? "clicks" : metric; // real key for the Google chart/scale
  const effYearMetric: SeoMetricKey = CHART_METRICS.includes(yearMetric) ? yearMetric : "clicks";
  // Top-chart heading label (leads has no SEARCH_METRICS entry).
  const metricTitle = isAi
    ? "AI citations"
    : metric === "leads"
      ? "Website leads"
      : (SEARCH_METRICS.find((m) => m.key === metric)?.label ?? "Clicks");
  const activeYearMetric = SEARCH_METRICS.find((m) => m.key === effYearMetric)!;
  const scale28 = useMemo(() => chartScale(sd.series, gMetric), [sd, gMetric]);
  const scaleYear = useMemo(() => chartScale(sd.yearSeries, effYearMetric), [sd, effYearMetric]);

  // Top tiles: Clicks · Impressions · AI citations (range-bound, CSV-fed) · CTR ·
  // Avg position. All chartable; clicking AI shows the dashed citations line.
  const aiTip = "Times your site was cited as a source in AI answers (Microsoft Copilot + Bing). From your uploaded Copilot CSV exports — always exact (never delayed), though the most recent days appear once the next CSV is uploaded.";
  const topTiles = [
    { key: "clicks" as const, label: SEARCH_METRICS[0].label, icon: SEARCH_METRICS[0].icon, tip: SEARCH_METRICS[0].tip, value: sd.totals.clicks, fmt: fmtIntRound, delta: sd.deltas.clicks, invert: false },
    { key: "impressions" as const, label: SEARCH_METRICS[1].label, icon: SEARCH_METRICS[1].icon, tip: SEARCH_METRICS[1].tip, value: sd.totals.impressions, fmt: fmtIntRound, delta: sd.deltas.impressions, invert: false },
    { key: "aiCitations" as const, label: "AI citations", icon: Sparkles, tip: aiTip, value: data.ai.totalCitations, fmt: fmtCompact, delta: data.ai.deltas.citations, invert: false },
    // When "Show leads" is on, the Website leads tile replaces CTR (it also
    // drives the top chart). Avg position always stays.
    data.leads
      ? { key: "leads" as const, label: "Website leads", icon: Users, tip: "Leads that came in through your website or chat widget (not ads), counted from your CRM over the selected period.", value: data.leads.totals.leads, fmt: fmtIntRound, delta: data.leads.deltas.leads, invert: false }
      : { key: "ctr" as const, label: SEARCH_METRICS[3].label, icon: SEARCH_METRICS[3].icon, tip: SEARCH_METRICS[3].tip, value: sd.totals.ctr, fmt: fmtPct1, delta: sd.deltas.ctr, invert: false },
    { key: "position" as const, label: SEARCH_METRICS[4].label, icon: SEARCH_METRICS[4].icon, tip: SEARCH_METRICS[4].tip, value: sd.totals.position, fmt: fmtPos, delta: sd.deltas.position, invert: true },
  ];

  return (
    <main className="w-[92vw] lg:w-[78vw] max-w-[1280px] mx-auto py-6 flex flex-col gap-6 md:gap-8">
      {/* Date-range picker — left-aligned with a label, same as /ads + /socials.
          Drives the search tiles + trend and the GA4 tiles (the per-day metrics);
          the top-N tables + AI citations are stored snapshots. */}
      {picker ? (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-full md:w-auto">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">Period</div>
            {picker}
          </div>
        </div>
      ) : null}

      {/* ── Search performance ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionHead title="Search performance"
          sub={<><SourceBadge source="google" /><Dot /><Period>{data.period.label}</Period></>} />

        {/* 5 tiles: 2-up on mobile with the lone 5th centered (col-span-2,
            half-width, auto-margins); 3-up at sm; 5-up at lg. */}
        <div className="isolate grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 [&>*:last-child]:max-sm:col-span-2 [&>*:last-child]:max-sm:mx-auto [&>*:last-child]:max-sm:w-[calc(50%-0.3125rem)]">
          {topTiles.map((m) => (
            <StatTile key={m.key} label={m.label} value={m.value} format={m.fmt} delta={m.delta} invert={m.invert}
              icon={m.icon} tip={m.tip} active={metric === m.key} onClick={() => setMetric(m.key)} />
          ))}
        </div>

        {/* Trend chart — desktop only (no graphs on mobile, just the stats above). */}
        <section className="hidden md:block bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 transition-colors duration-200 hover:border-[var(--surface-3)]/70">
          <div className="flex items-center gap-2.5 mb-3 flex-wrap">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{metricTitle}</h2>
            {isAi ? (
              <SourceBadge source="bing" label="Bing · Microsoft Copilot" />
            ) : metric === "leads" ? (
              <span className="text-[12px] text-[var(--text-secondary)]">Website · CRM</span>
            ) : (
              <SourceBadge source="google" />
            )}<Dot /><Period>{data.period.label}</Period>
          </div>
          <TrendChart series={sd.series} metric={metric} scale={scale28} dataEndDay={dataEndStr}
            ai={{ series: data.ai.series, dataStart: data.ai.dataStart, dataEnd: data.ai.dataEnd }} />
        </section>
      </section>

      {/* ── Keyword + page tables (sortable, scrollable) ────────────────── */}
      <SearchTable title="Keywords you rank for" icon={Search} source="google" rows={sd.topQueries.slice(0, 20)} firstHeader="Query" firstValue={(r) => (r as QueryRow).query} showPosition />
      <SearchTable title="Top pages" icon={FileText} source="google" rows={sd.topPages.slice(0, 20)} firstHeader="Page" firstValue={(r) => (r as PageRow).page} />

      {/* ── GA4 website analytics ────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <SectionHead title="Website analytics" sub={<><SourceBadge source="ga4" /><Dot /><Period>{data.period.label}</Period></>} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <StatTile label="Sessions" value={data.ga4.totals.sessions} format={fmtIntRound} delta={data.ga4.deltas.sessions} icon={Users} tip="Visits to the site during the period — a session groups a visitor's activity." />
          <StatTile label="Users" value={data.ga4.totals.users} format={fmtIntRound} delta={data.ga4.deltas.users} icon={Users} tip="Distinct people who visited the site during the period." />
          <StatTile label="Page views" value={data.ga4.totals.pageViews} format={fmtIntRound} delta={data.ga4.deltas.pageViews} icon={Eye} tip="Total page views recorded across the site during the period." />
          <StatTile label="Engagement rate" value={data.ga4.totals.engagementRate} format={fmtPct1} delta={data.ga4.deltas.engagementRate} icon={Clock} tip="Share of sessions that were engaged (10s+, a conversion, or 2+ page views)." />
        </div>
        {/* Donut a touch wider than half the row, top landing pages a touch narrower.
            grid-cols-1 base so the mobile single column is minmax(0,1fr) (fills +
            shrinks) — without it a bare grid uses auto columns (max-content) and
            overflows the screen. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_1fr]">
          <TrafficSourcesCard channels={data.ga4.channels} />
          <RankedList title="Top landing pages" sub="sessions" icon={Globe} source="ga4"
            items={data.ga4.landingPages.map((l) => ({ label: l.page, value: l.sessions }))} valueFmt={fmtInt} />
        </div>
      </section>

      {/* ── AI Performance (Bing Copilot citations) ──────────────────────── */}
      <section className="flex flex-col gap-4">
        {/* Always the FULL uploaded AI history (data.aiAll), independent of the
            date picker — the chart spans exactly the uploaded data. */}
        <SectionHead title="AI Performance"
          sub={<><SourceBadge source="bing" label="Bing · Microsoft Copilot" /><Dot /><Period>{data.aiAll.dataStart && data.aiAll.dataEnd ? `${fmtDay(data.aiAll.dataStart)} – ${fmtDay(data.aiAll.dataEnd)}` : "all uploaded data"}</Period></>} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
            <AiFeatureCard icon={Sparkles} label="Total citations" value={data.aiAll.totalCitations} format={fmtCompact} delta={data.aiAll.deltas.citations}
              caption="cited as a source in AI answers" tip="Times your site was cited as a source in AI answers (Copilot + Bing AI summaries) — all-time, across every uploaded day." />
            <AiFeatureCard icon={FileText} label="Avg cited pages" value={data.aiAll.avgCitedPages} format={fmtIntRound} delta={data.aiAll.deltas.citedPages}
              caption="distinct pages referenced / day" tip="Daily average number of distinct pages from your site referenced across AI experiences, over all uploaded data." />
          </div>
          {/* Citations chart — desktop only (no graphs on mobile). */}
          <section className="hidden md:block bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 transition-colors duration-200 hover:border-[var(--surface-3)]/70">
            <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3">Citations over time</h2>
            <AiCitationsChart series={data.aiAll.series} dataStart={data.aiAll.dataStart} dataEnd={data.aiAll.dataEnd} />
          </section>
        </div>
        {/* Grounding queries + cited pages — desktop only (kept the two headline
            AI stat cards above; these deeper lists are hidden on mobile). */}
        <div className="hidden md:grid md:grid-cols-1 gap-6 lg:grid-cols-2">
          <RankedList title="Top grounding queries" sub="what AI asked to find you" icon={Search}
            items={data.aiAll.groundingQueries.map((q) => ({ label: q.label, value: q.citations }))} valueFmt={fmtInt} />
          <RankedList title="Top cited pages" sub="your pages AI references" icon={FileText}
            items={data.aiAll.citedPages.map((p) => ({ label: p.label, value: p.citations }))} valueFmt={fmtInt} />
        </div>
      </section>

      {/* ── 12-month trend — desktop only (graph-heavy section, hidden on mobile) ── */}
      <section className="hidden md:flex flex-col gap-4">
        <SectionHead title="12-month trend"
          sub={<><SourceBadge source="google" /><Dot /><Period>trailing 365 days</Period></>} />
        <div className="isolate grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {SEARCH_METRICS.map((m) => {
            const chartable = CHART_METRICS.includes(m.key);
            return (
              <StatTile key={m.key} label={m.label} value={m.num(sd.yearTotals)} format={m.vfmt} delta={sd.yearDeltas[m.key]} invert={m.invert} deltaFormat={m.deltaFormat}
                icon={m.icon} tip={m.tip} active={chartable && m.key === effYearMetric}
                onClick={chartable ? () => setYearMetric(m.key) : undefined} />
            );
          })}
        </div>
        <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-5 transition-colors duration-200 hover:border-[var(--surface-3)]/70">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{activeYearMetric.label}</h2>
              <span className="text-[12px] text-[var(--text-tertiary)]">last 12 months</span>
            </div>
            <div className="flex items-center gap-4 text-[11.5px] text-[var(--text-secondary)]">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--ps-yellow)" }} />Daily</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3.5" style={{ background: "var(--chart-2)" }} />Trend</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-3.5 border-t-2 border-dashed border-[var(--text-secondary)]" />Avg</span>
            </div>
          </div>
          <YearChart series={sd.yearSeries} metric={effYearMetric} scale={scaleYear} />
        </section>
      </section>

      {/* ── Local SEO grid ────────────────────────────────────────────────────
          Desktop only — the interactive Leaflet geo-grid + its wide competitor
          table aren't a mobile experience, so the whole section (live map OR the
          locked upsell teaser) is hidden below md.
          `seo`-upsell clients get the real geo-grid (once a BrightLocal report is
          configured + pulled). Web-only clients instead get a LOCKED teaser. */}
      <div className="hidden md:block">
        {showLocalSeo
          ? data.localGrids.length > 0 && <LocalSeoSection grids={data.localGrids} clientId={clientId} />
          : <LocalSeoLocked />}
      </div>
    </main>
  );
}

/** Local SEO ranking grid (BrightLocal geo-grid) — gated on the `seo` upsell +
 *  the presence of pulled grid data by the caller. Renders one map per report
 *  (location), stacked, each headed by its business name when there's >1. */
function LocalSeoSection({ grids, clientId }: { grids: LocalGrid[]; clientId: string }) {
  const many = grids.length > 1;
  return (
    <section className="flex flex-col gap-4">
      <SectionHead title="Local search grid"
        sub={<span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]"><MapPin size={13} className="text-[var(--accent-fg)]" />Map rankings around your {many ? "locations" : "business"}</span>} />
      <div className="flex flex-col gap-6">
        {grids.map((g) => (
          <div key={g.reportId} className="flex flex-col gap-2.5">
            {many && g.business?.name && (
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                <MapPin size={14} className="text-[var(--accent-fg)]" />{g.business.name}
              </h3>
            )}
            <LocalSeoMap grid={g} clientId={clientId} />
          </div>
        ))}
      </div>
    </section>
  );
}
