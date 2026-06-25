/**
 * Locked "Local search grid" teaser — shown at the bottom of the Web & SEO tab
 * for clients on the base `web` product but WITHOUT the `seo` add-on. Renders the
 * real <LocalSeoMap> behind glass: a blurred, non-interactive mock St. Louis
 * heatmap (colourful, so it stays intriguing) under a lock overlay. Hovering the
 * lock reveals a "contact your Relay representative" tooltip so clients
 * discover the service.
 *
 * Mock data only — illustrative ranks (strong near "home", fading outward), never
 * a real client's grid.
 */
import { Lock } from "lucide-react";
import { LocalSeoMap } from "./local-seo-map";
import type { LocalGrid, LocalGridPoint } from "@/lib/seo-mock";

const STL = { lat: 38.647, lng: -90.3 };
// 5×5 illustrative rank matrix (1 = best). Centre ranks well, edges fade.
const MOCK_RANKS = [
  9, 7, 6, 8, 11,
  6, 4, 3, 4, 7,
  5, 2, 1, 3, 6,
  6, 3, 2, 4, 8,
  10, 7, 5, 7, 12,
];

function mockGrid(): LocalGrid {
  const dLat = 0.0145, dLng = 0.0185; // ≈ 1 mile at St. Louis' latitude
  const points: LocalGridPoint[] = [];
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++)
      points.push({ lat: STL.lat + (2 - r) * dLat, lng: STL.lng + (c - 2) * dLng, rank: MOCK_RANKS[r * 5 + c], pointId: "", top: [] });
  const kw = (keywordId: number, keyword: string, avgRank: number) => ({
    keywordId, keyword, runId: 0, runDate: "", avgRank, numPoints: 25,
    bands: { high: null, med: null, low: null }, points, history: [], competitors: [],
  });
  return {
    reportId: 0, gridSize: "5x5", gridSpacing: "1mi",
    center: STL, business: { lat: STL.lat, lng: STL.lng, name: "Your business" },
    keywords: [kw(1, "your service near me", 4.6), kw(2, "best in St. Louis", 3.4), kw(3, "near me", 5.1)],
  };
}

export function LocalSeoLocked() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Local search grid</h1>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md bg-[var(--ps-yellow)]/12 border border-[var(--ps-yellow)]/35 text-[var(--accent-fg)]">
          <Lock size={11} strokeWidth={2.5} /> Premium
        </span>
      </div>

      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-[var(--surface-3)]/40">
        {/* Real map behind glass — blurred + dimmed + inert, but the colourful
            heatmap reads through, which is what makes the locked feature intriguing. */}
        <div className="blur-[3px] opacity-[0.72] pointer-events-none select-none" aria-hidden>
          <LocalSeoMap grid={mockGrid()} clientId="locked" />
        </div>

        {/* Lock overlay — the copy sits on a frosted card so it stays crisp and
            legible over the busy blurred heatmap on either theme. */}
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div aria-hidden className="absolute inset-0 bg-[var(--surface-0)]/30" />
          <div className="relative flex flex-col items-center text-center gap-3.5 max-w-[370px] rounded-2xl border border-[var(--surface-3)]/70 bg-[var(--surface-1)]/92 backdrop-blur-md px-7 py-7 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.65)]">
            {/* Lock badge — hover target for the tooltip. */}
            <div className="group relative">
              <div className="flex items-center justify-center h-14 w-14 rounded-full bg-[var(--ps-yellow)]/12 border border-[var(--ps-yellow)]/40 cursor-help transition-transform duration-200 hover:scale-105">
                <Lock size={22} className="text-[var(--accent-fg)]" strokeWidth={2.25} />
              </div>
              <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2.5 w-60 z-20 opacity-0 translate-y-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-y-0">
                <div className="rounded-lg bg-[var(--surface-0)] border border-[var(--surface-3)] shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] px-3 py-2.5 text-[12.5px] leading-snug text-[var(--text-secondary)]">
                  <span className="text-[var(--text-primary)] font-semibold">Contact your Relay representative</span> to add Local SEO.
                </div>
              </div>
            </div>
            <div className="text-[17px] font-bold tracking-tight text-[var(--text-primary)] leading-snug">See exactly where you rank on the map</div>
            <p className="text-[13.5px] text-[var(--text-secondary)] leading-relaxed">
              Track your Google Maps ranking for every key search across your service area — block by block.
            </p>
            <span className="text-[12.5px] font-semibold text-[var(--accent-fg)]">Available with our SEO service</span>
          </div>
        </div>
      </div>
    </section>
  );
}
