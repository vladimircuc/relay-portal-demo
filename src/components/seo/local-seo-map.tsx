"use client";

/**
 * Local search ranking grid — an interactive Leaflet map of a client's
 * BrightLocal geo-grid. Each grid point is a rank-colored pin (green = top 3,
 * amber 4–10, red 11–19, gray 20+); the business location is the yellow center
 * marker. A keyword switcher swaps the active grid, and the headline shows the
 * average map rank with a per-band breakdown (+ an avg-rank trend once there's
 * more than one run).
 *
 * Leaflet touches `window` at import time, so it's dynamically imported inside
 * the mount effect (client components still SSR for the initial HTML). The map
 * is created once; theme + keyword changes mutate it in place (no re-create, so
 * switching keywords doesn't flicker). Free CARTO dark/light tiles — no token.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type * as LType from "leaflet";
import { MapPin, Star, Award, CalendarDays, X } from "lucide-react";
import { useTheme } from "@/components/theme-context";
import type { LocalGrid } from "@/lib/seo-mock";

// Rank bands (lower rank = better). A point that doesn't rank in the top 20
// comes back as 0/null → treated as "20+" (gray). Mirrors the user's spec:
// green ≤3 · amber 4–10 · red 11–19 · gray 20+.
const BANDS = [
  { key: "high", label: "1–3", color: "#22c55e" },
  { key: "mid", label: "4–10", color: "#f59e0b" },
  { key: "low", label: "11–19", color: "#ef4444" },
  { key: "none", label: "20+", color: "#6b7280" },
] as const;

function bandIndex(rank: number): number {
  if (rank <= 0 || rank >= 20) return 3; // 20+ / not found
  if (rank <= 3) return 0;
  if (rank <= 10) return 1;
  return 2; // 11–19
}
const bandColor = (rank: number) => BANDS[bandIndex(rank)].color;
const rankLabel = (rank: number) => (rank <= 0 || rank >= 20 ? "20+" : String(rank));

/** "2026-06-09" → "Jun 9, 2026" (the day BrightLocal actually ran the grid —
 *  i.e. the report date, NOT our last pull). Empty string if no/garbage date. */
const fmtRunDate = (iso: string | undefined): string => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const TILE = (theme: string) =>
  theme === "light"
    ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

function pointIconHtml(rank: number, isBiz = false): string {
  const color = bandColor(rank);
  const label = rankLabel(rank);
  const size = isBiz ? 36 : 30;
  const fontSize = label.length > 2 ? (isBiz ? 12 : 10) : isBiz ? 15 : 12;
  // The business's own grid point keeps its rank disc but gets an unmistakable
  // white+yellow halo ("you are here") that reads on top of ANY band color —
  // so you SEE the rank at your location instead of it being covered by a pin.
  const ring = isBiz
    ? "border:2px solid #0a0a0a;box-shadow:0 0 0 3px #fff,0 0 0 6px #ff6a00,0 0 18px 3px rgba(255,209,0,0.65)"
    : "border:2px solid rgba(0,0,0,0.35);box-shadow:0 0 0 2px rgba(255,255,255,0.12),0 2px 8px rgba(0,0,0,0.5)";
  return `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};color:#0a0a0a;
    font-weight:800;font-size:${fontSize}px;line-height:1;display:flex;align-items:center;justify-content:center;${ring}">${label}</div>`;
}

/** Compact inline avg-rank-over-time trend (lower = better → drawn inverted).
 *  Only rendered when there are ≥2 runs of history. */
function RankTrend({ history }: { history: { date: string; avgRank: number | null }[] }) {
  const pts = history.filter((h) => h.avgRank != null) as { date: string; avgRank: number }[];
  if (pts.length < 2) return null;
  const W = 160, H = 40, pad = 4;
  const vals = pts.map((p) => p.avgRank);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  // Invert: a LOWER (better) rank sits HIGHER on the chart.
  const y = (v: number) => pad + ((v - min) / span) * (H - 2 * pad);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.avgRank).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <div className="flex items-center gap-2">
      <svg width={W} height={H} className="overflow-visible">
        <path d={d} fill="none" stroke="var(--ps-yellow)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(last.avgRank)} r={3} fill="var(--ps-yellow)" />
      </svg>
      <span className="text-[11px] text-[var(--text-tertiary)] whitespace-nowrap">avg rank · {pts.length} runs</span>
    </div>
  );
}

/** Gold 5-star rating with fractional fill: a muted base row + a bright gold
 *  row clipped to the rating fraction, with the numeric value beside it. */
function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-[12px] text-[var(--text-tertiary)]">—</span>;
  const pct = Math.max(0, Math.min(100, (rating / 5) * 100));
  const row = (cls: string) => (
    <span className={"flex gap-px " + cls}>
      {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={14} strokeWidth={0} fill="currentColor" className="shrink-0" />)}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5" title={`${rating.toFixed(1)} / 5`}>
      <span className="relative inline-flex">
        {row("text-[var(--text-tertiary)]/35")}
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>{row("text-[#FFC53D]")}</span>
      </span>
      <span className="text-[12px] font-medium text-[var(--text-secondary)] tabular-nums">{rating.toFixed(1)}</span>
    </span>
  );
}

/** Medal gradient for the top-3 competitor ranks; neutral chip for the rest. */
const MEDAL: Record<number, string> = {
  1: "bg-gradient-to-b from-[#FFE082] to-[#F4B400] text-[#3a2a00] shadow-[0_2px_8px_-2px_rgba(244,180,0,0.7)]",
  2: "bg-gradient-to-b from-[#EDEFF2] to-[#AEB4BC] text-[#2a2d31] shadow-[0_2px_8px_-3px_rgba(174,180,188,0.7)]",
  3: "bg-gradient-to-b from-[#EAB78B] to-[#C17B49] text-[#3a1f0a] shadow-[0_2px_8px_-3px_rgba(193,123,73,0.7)]",
};
const rankBadgeClass = (rank: number) => MEDAL[rank] ?? "bg-[var(--surface-3)]/60 text-[var(--text-secondary)]";

// Shared column template so the competitor header + every row line up:
// Business · Avg rank · Links · Authority · Reviews · Rating · Category.
const GRID = "grid grid-cols-[minmax(150px,1fr)_64px_56px_76px_64px_152px_minmax(96px,150px)] items-center gap-x-3";

type PointBusiness = { rank: number; name: string; reviews: number | null; rating: number | null; isClient: boolean };
type PointPopup = { x: number; y: number; below: boolean; rank: number; loading: boolean; businesses: PointBusiness[]; error?: boolean };

/** One ranked-business row inside the point popup (rank disc + name + "You"). */
function BizRow({ b }: { b: PointBusiness }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold text-[#0a0a0a] shrink-0" style={{ background: bandColor(b.rank) }}>
        {rankLabel(b.rank)}
      </span>
      <span className={"text-[12px] truncate flex-1 " + (b.isClient ? "font-semibold text-[var(--accent-fg)]" : "text-[var(--text-primary)]")}>{b.name}</span>
      {b.isClient && <span className="text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] shrink-0">You</span>}
    </div>
  );
}

/** Top 3 at the point + the client's own row appended when they're outside top 3. */
function PointPopupBody({ businesses }: { businesses: PointBusiness[] }) {
  if (!businesses.length) return <div className="text-[12px] text-[var(--text-secondary)] py-1.5">No results at this point.</div>;
  const top3 = businesses.slice(0, 3);
  const me = businesses.find((b) => b.isClient);
  const meInTop3 = top3.some((b) => b.isClient);
  return (
    <div className="flex flex-col gap-1.5">
      {top3.map((b) => <BizRow key={b.rank} b={b} />)}
      {me && !meInTop3 && (
        <>
          <div className="h-px bg-[var(--surface-3)]/60 my-0.5" />
          <BizRow b={me} />
        </>
      )}
    </div>
  );
}

type Competitor = LocalGrid["keywords"][number]["competitors"][number];

/** One metric label+value pair inside the mobile competitor card. */
function CompStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">{label}</span>
      <span className={"truncate tabular-nums " + (strong ? "text-[14px] font-semibold text-[var(--text-primary)]" : "text-[12.5px] text-[var(--text-secondary)]")}>{value}</span>
    </div>
  );
}

/** Mobile competitor row as a STACKED CARD. The desktop 7-column table is
 *  720px-min wide, which forces an awkward horizontal scroll on a phone — so
 *  below md we render each competitor as a self-contained card instead. */
function CompetitorCard({ c }: { c: Competitor }) {
  return (
    <div className={"relative rounded-lg border px-3 py-3 flex flex-col gap-2.5 " +
      (c.isClient ? "border-[var(--ps-yellow)]/55 bg-[var(--ps-yellow)]/[0.08]" : "border-[var(--surface-3)]/45 bg-[var(--surface-2)]/30")}>
      {c.isClient && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--ps-yellow)]" />}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={"flex items-center justify-center h-7 w-7 rounded-full text-[12px] font-bold shrink-0 " + rankBadgeClass(c.rank)}>{c.rank}</span>
        <span className={"truncate text-[13.5px] flex-1 " + (c.isClient ? "font-semibold text-[var(--accent-fg)]" : "font-medium text-[var(--text-primary)]")}>{c.title}</span>
        {c.isClient && <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] shrink-0">You</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <CompStat label="Avg. rank" value={c.avgRank != null ? c.avgRank.toFixed(1) : "—"} strong />
        <CompStat label="Reviews" value={c.reviews != null ? c.reviews.toLocaleString() : "—"} />
        <CompStat label="Authority" value={c.authority != null ? `${c.authority}/100` : "—"} />
        <CompStat label="Links" value={c.links != null ? c.links.toLocaleString() : "—"} />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Rating</span>
          <Stars rating={c.rating} />
        </div>
        <CompStat label="Category" value={c.category ?? "—"} />
      </div>
    </div>
  );
}

export function LocalSeoMap({ grid, clientId }: { grid: LocalGrid; clientId: string }) {
  const { theme } = useTheme();
  const [activeKwId, setActiveKwId] = useState<number>(grid.keywords[0]?.keywordId ?? 0);
  const [ready, setReady] = useState(false);
  // On-demand "who ranks here" popup, positioned over the map at the clicked pin.
  const [popup, setPopup] = useState<PointPopup | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const LRef = useRef<typeof LType | null>(null);
  const tileRef = useRef<LType.TileLayer | null>(null);
  const layerRef = useRef<LType.LayerGroup | null>(null);
  // Bumped on each click so a slow fetch from a previous point can't overwrite
  // the popup for the point you just clicked.
  const popupReqRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kw = useMemo(
    () => grid.keywords.find((k) => k.keywordId === activeKwId) ?? grid.keywords[0],
    [grid.keywords, activeKwId],
  );

  // Per-band point counts for the legend (computed from the actual points, not
  // the summary, so it always matches what's drawn).
  const bandCounts = useMemo(() => {
    const c = [0, 0, 0, 0];
    for (const p of kw?.points ?? []) c[bandIndex(p.rank)]++;
    return c;
  }, [kw]);

  // (1) Create the map ONCE (browser-only). Tiles + points are added by the
  //     theme/keyword effects below, which fire once `ready` flips true.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      LRef.current = L;
      const c = grid.center ?? (kw?.points[0] ? { lat: kw.points[0].lat, lng: kw.points[0].lng } : { lat: 0, lng: 0 });
      // Fully LOCKED to the default fitted view — no pan, zoom, or scroll. The
      // grid is a fixed snapshot, so there's nothing to explore by dragging; a
      // static frame also stops the map from stealing page scroll.
      const map = L.map(containerRef.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        attributionControl: true,
      }).setView([c.lat, c.lng], 12);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      // Clear the pending hover-hide timer so it can't fire setPopup after the
      // component unmounts (an in-flight point fetch resolving post-unmount is a
      // harmless no-op in React 18+).
      if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      tileRef.current = null;
      setReady(false);
    };
    // Mount-once: grid identity changes only on a full page nav (new instance).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (2) Tile layer — swap on theme change.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current;
    if (!ready || !L || !map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    tileRef.current = L.tileLayer(TILE(theme), {
      subdomains: "abcd",
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(map);
    // Tiles sit under everything else.
    tileRef.current.bringToBack();
  }, [theme, ready]);

  // (3) Points + business marker — rebuild on keyword change.
  useEffect(() => {
    const L = LRef.current, map = mapRef.current, layer = layerRef.current;
    if (!ready || !L || !map || !layer || !kw) return;
    map.invalidateSize();
    layer.clearLayers();
    setPopup(null); // close any open "who ranks here" popup when the keyword changes

    // Which grid point is the business sitting on? Mark the nearest point to the
    // business (or grid center) as "you are here" — keeping its rank visible —
    // rather than overlaying a separate marker that hides the center rank.
    const anchor = grid.business ?? grid.center;
    let bizIdx = -1;
    if (anchor && kw.points.length) {
      let best = Infinity;
      kw.points.forEach((p, i) => {
        const d = (p.lat - anchor.lat) ** 2 + (p.lng - anchor.lng) ** 2;
        if (d < best) { best = d; bizIdx = i; }
      });
    }

    const activeKw = kw; // capture for the async click closure
    const latlngs: [number, number][] = [];
    kw.points.forEach((p, i) => {
      latlngs.push([p.lat, p.lng]);
      const isBiz = i === bizIdx;
      const size = isBiz ? 36 : 30;
      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: isBiz ? "lsg-pin lsg-pin-biz" : "lsg-pin", html: pointIconHtml(p.rank, isBiz), iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        zIndexOffset: isBiz ? 1000 : 0,
      }).addTo(layer);
      // Open the "who ranks here" popup for this point. Instant from the
      // preloaded `top` (top 3 + the client's own row); only falls back to a live
      // fetch for points not yet backfilled. Positioned at the pin (the map is
      // locked, so the pixel position stays valid until the keyword changes).
      //
      // Bound to BOTH hover (instant on desktop) AND click/tap — touch devices
      // have no hover, so without the click binding the core "who ranks here"
      // feature was invisible on mobile. openPopup clears any pending hide timer,
      // so the touch sequence mouseover→mouseout→click still nets to "open".
      const openPopup = () => {
        if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        // Keep the card inside the map: clamp its center, and flip it BELOW the
        // pin when there isn't room above (near the top edge).
        const size = map.getSize();
        const x = Math.max(154, Math.min(size.x - 154, pt.x));
        const below = pt.y < 180;
        const base = { x, y: pt.y, below, rank: p.rank };
        if (p.top && p.top.length) {
          popupReqRef.current++; // cancel any in-flight fetch from a prior open
          setPopup({ ...base, loading: false, businesses: p.top });
          return;
        }
        // Fallback: fetch live (a point pulled before per-point preloading shipped).
        const reqId = ++popupReqRef.current;
        setPopup({ ...base, loading: true, businesses: [] });
        if (!p.pointId) { setPopup({ ...base, loading: false, businesses: [], error: true }); return; }
        fetch(`/api/seo-grid/point/${clientId}?keywordId=${activeKw.keywordId}&pointId=${encodeURIComponent(p.pointId)}`, { cache: "no-store" })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (reqId !== popupReqRef.current) return;
            if (!res.ok) setPopup({ ...base, loading: false, businesses: [], error: true });
            else setPopup({ ...base, loading: false, businesses: (data.businesses ?? []) as PointBusiness[] });
          })
          .catch(() => { if (reqId === popupReqRef.current) setPopup({ ...base, loading: false, businesses: [], error: true }); });
      };
      marker.on("mouseover", openPopup);
      marker.on("click", openPopup);
      // Desktop: a small grace period on mouse-out so moving the cursor onto the
      // card (or an adjacent pin) doesn't flicker it closed. Touch has no
      // mouseout — the card's X button closes it there.
      marker.on("mouseout", () => {
        hideTimerRef.current = setTimeout(() => setPopup(null), 140);
      });
    });

    if (latlngs.length) {
      map.fitBounds(L.latLngBounds(latlngs).pad(0.2), { animate: false });
    }
  }, [kw, ready, grid.business, grid.center, clientId]);

  const avgRank = kw?.avgRank;

  return (
    // `relative z-0` confines Leaflet's internal z-indices (panes ~z-400,
    // controls ~z-1000) to this card's stacking context so the map can't paint
    // over the sticky page header (z-10) when scrolled under it.
    <div className="relative z-0 bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] overflow-hidden">
      {/* Header: keyword switcher + headline avg rank + legend. */}
      <div className="p-5 flex flex-col gap-4 border-b border-[var(--surface-3)]/40">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">Average map rank</span>
              {kw?.runDate && (
                <span
                  title="The day this ranking grid was last run"
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--surface-3)]/60 bg-[var(--surface-2)]/60 px-2 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)]"
                >
                  <CalendarDays size={12} strokeWidth={2} />
                  Ranked {fmtRunDate(kw.runDate)}
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                {avgRank != null ? avgRank.toFixed(1) : "—"}
              </span>
              <span className="text-[12px] text-[var(--text-tertiary)]">
                across {kw?.numPoints ?? kw?.points.length ?? 0} points
                {grid.gridSize ? ` · ${grid.gridSize}` : ""}
                {grid.gridSpacing ? ` · ${grid.gridSpacing} spacing` : ""}
              </span>
            </div>
          </div>
          {kw && <RankTrend history={kw.history} />}
        </div>

        {/* Keyword pills. */}
        {grid.keywords.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {grid.keywords.map((k) => {
              const active = k.keywordId === activeKwId;
              return (
                <button
                  key={k.keywordId}
                  type="button"
                  onClick={() => setActiveKwId(k.keywordId)}
                  className={"px-2.5 h-7 rounded-md text-[12px] font-medium transition-colors " +
                    (active
                      ? "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)]"
                      : "bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)]/60")}
                >
                  {k.keyword}
                </button>
              );
            })}
          </div>
        )}

        {/* Legend with live per-band counts. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {BANDS.map((b, i) => (
            <span key={b.key} className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
              {b.label}
              <span className="text-[var(--text-tertiary)]">{bandCounts[i]}</span>
            </span>
          ))}
          {grid.business && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)] ml-auto">
              <MapPin size={12} className="text-[var(--accent-fg)]" />
              {grid.business.name ?? "Your business"}
            </span>
          )}
        </div>
      </div>

      {/* The map itself. Fixed height so Leaflet has a box to render into. The
          relative wrapper anchors the hover popup at the pin. */}
      <div className="relative">
        <div ref={containerRef} className="lsg-map h-[420px] md:h-[520px] w-full" />
        {/* Touch hint — the pins open on tap (no hover on mobile). Desktop users
            get the same popup on hover, so the hint is mobile-only. */}
        <div className="md:hidden pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 z-[400] rounded-full bg-[var(--surface-0)]/85 border border-[var(--surface-3)]/60 px-3 py-1 text-[11px] text-[var(--text-secondary)] backdrop-blur-sm">
          Tap a point to see who ranks there
        </div>
        {popup && (
          <div
            className={"absolute z-[500] -translate-x-1/2 ps-pop-in " + (popup.below ? "" : "-translate-y-full")}
            style={{ left: popup.x, top: popup.below ? popup.y + 24 : popup.y - 22 }}
            // Keep the card open while the cursor is on it (it sits just above the
            // pin); leaving it re-arms the same grace-period hide as the pin.
            onMouseEnter={() => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; } }}
            onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setPopup(null), 140); }}
          >
            <div className="w-[min(300px,80vw)] rounded-lg bg-[var(--surface-0)] border border-[var(--surface-3)] shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">Who ranks here</span>
                {/* Touch has no hover-out — give an explicit close. */}
                <button
                  type="button"
                  onClick={() => setPopup(null)}
                  aria-label="Close"
                  className="md:hidden -mr-1 -mt-0.5 h-6 w-6 flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X size={14} />
                </button>
              </div>
              {popup.loading ? (
                <div className="text-[12px] text-[var(--text-secondary)] py-1.5">Loading…</div>
              ) : popup.error ? (
                <div className="text-[12px] text-[var(--text-secondary)] py-1.5">Couldn&apos;t load this point.</div>
              ) : (
                <PointPopupBody businesses={popup.businesses} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Top ranking competitors — BrightLocal's column set (Business · Avg rank
          · Links · Authority · Reviews · Rating · Category), as premium dark
          hover-lift cards with a shared grid so columns line up with the header. */}
      {kw && kw.competitors.length > 0 && (
        <div className="p-5 border-t border-[var(--surface-3)]/40 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Award size={15} className="text-[var(--accent-fg)]" />
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              Top ranking competitors <span className="text-[var(--text-tertiary)] font-normal">· {kw.keyword}</span>
            </h3>
          </div>

          {/* Mobile: stacked cards (no horizontal scroll). */}
          <div className="md:hidden flex flex-col gap-2">
            {kw.competitors.map((c) => (
              <CompetitorCard key={`m-${kw.keywordId}-${c.rank}`} c={c} />
            ))}
          </div>

          {/* Desktop: the wide, column-aligned BrightLocal-style table. */}
          <div className="hidden md:block overflow-x-auto -mx-1 px-1">
            <div className="min-w-[720px] flex flex-col gap-1.5">
              <div className={GRID + " px-3 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]"}>
                <span>Business</span>
                <span>Avg. rank</span>
                <span>Links</span>
                <span>Authority</span>
                <span>Reviews</span>
                <span>Rating</span>
                <span>Category</span>
              </div>
              {kw.competitors.map((c, i) => (
                <div
                  key={`${kw.keywordId}-${c.rank}`}
                  className={"ps-row-in group relative " + GRID + " rounded-lg border px-3 py-2.5 transition-[transform,background-color,border-color,box-shadow] duration-200 " +
                    (c.isClient
                      ? "border-[var(--ps-yellow)]/55 bg-[var(--ps-yellow)]/[0.08]"
                      : "border-[var(--surface-3)]/45 bg-[var(--surface-2)]/30 hover:bg-[var(--surface-2)]/70 hover:border-[var(--surface-3)] hover:-translate-y-px hover:shadow-[0_8px_22px_-12px_rgba(0,0,0,0.75)]")}
                  style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                >
                  {c.isClient && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--ps-yellow)]" />}
                  {/* Business: rank badge (medal for top 3) + name. */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={"flex items-center justify-center h-7 w-7 rounded-full text-[12px] font-bold shrink-0 " + rankBadgeClass(c.rank)}>{c.rank}</span>
                    <span className={"truncate text-[13px] " + (c.isClient ? "font-semibold text-[var(--accent-fg)]" : "font-medium text-[var(--text-primary)]")}>{c.title}</span>
                    {c.isClient && <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] shrink-0">You</span>}
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{c.avgRank != null ? c.avgRank.toFixed(1) : "—"}</span>
                  <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">{c.links != null ? c.links.toLocaleString() : "—"}</span>
                  <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">{c.authority != null ? `${c.authority}/100` : "—"}</span>
                  <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">{c.reviews != null ? c.reviews.toLocaleString() : "—"}</span>
                  <span><Stars rating={c.rating} /></span>
                  <span className="truncate text-[12px] text-[var(--text-tertiary)]">{c.category ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
