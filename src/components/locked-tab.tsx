/**
 * Locked product tab — shown when a client opens a tab for a service they don't
 * have. A blurred, inert curated mock dashboard (so the tab feels alive and
 * intriguing) sits behind a single persistent modal that explains the service,
 * why it helps, and how to get it. One lock for the whole tab.
 *
 * Server component (fully static). Copy + teaser mock data come from
 * SERVICE_CATALOG so they stay consistent with the home-page service cards.
 */
import { Lock, Check } from "lucide-react";
import type { Capability } from "@/lib/auth";
import { SERVICE_CATALOG, type ServiceMeta, type ServiceTile } from "./service-catalog";

/** Mock area chart (normalised) — brand stroke + soft gradient fill. */
function MockArea({ series }: { series: number[] }) {
  const n = series.length;
  const min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => 38 - ((v - min) / span) * 34;
  const line = series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L100,40 L0,40 Z`;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-[170px]">
      <defs>
        <linearGradient id="lt-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ps-yellow)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--ps-yellow)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#lt-grad)" />
      <path d={line} fill="none" stroke="var(--ps-yellow)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TeaserTile({ tile }: { tile: ServiceTile }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-4 flex flex-col gap-2">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">{tile.label}</span>
      <span className="text-[24px] leading-none font-bold tabular-nums text-[var(--text-primary)]">{tile.value}</span>
      <span className="inline-flex items-center gap-1 w-fit text-[12px] font-semibold text-[var(--positive)] bg-[var(--positive)]/10 rounded-md px-1.5 py-0.5">↑ {tile.delta}</span>
    </div>
  );
}

/** Believable dashboard mock — period row, tiles, chart, list + donut. Blurred
 *  by the parent, so fidelity just needs to read as "a rich dashboard". */
function TeaserPreview({ meta }: { meta: ServiceMeta }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="h-7 w-44 rounded-md bg-[var(--surface-2)]" />
        <div className="h-7 w-52 rounded-md bg-[var(--surface-2)]" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {meta.teaserTiles.map((t) => <TeaserTile key={t.label} tile={t} />)}
      </div>
      <div className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-5 flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{meta.teaserChartLabel}</span>
        <MockArea series={meta.teaserSeries} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-5 flex flex-col gap-3.5">
          <div className="h-4 w-32 rounded bg-[var(--surface-2)]" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 rounded bg-[var(--surface-2)] flex-1" style={{ maxWidth: `${90 - i * 14}%` }} />
              <div className="h-3 w-10 rounded bg-[var(--surface-2)] shrink-0" />
            </div>
          ))}
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--surface-3)]/40 bg-[var(--surface-1)] p-5 flex items-center justify-center">
          <div className="h-32 w-32 rounded-full border-[14px] border-[var(--surface-2)] border-t-[var(--ps-yellow)] border-r-[var(--ps-yellow)]" />
        </div>
      </div>
    </div>
  );
}

export function LockedTab({ service }: { service: Capability }) {
  const meta = SERVICE_CATALOG[service];
  const Icon = meta.icon;
  return (
    <div className="relative isolate">
      {/* Inert, blurred curated dashboard behind glass. */}
      <div className="blur-[5px] opacity-60 pointer-events-none select-none" aria-hidden>
        <TeaserPreview meta={meta} />
      </div>

      {/* One lock for the whole tab. */}
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div aria-hidden className="absolute inset-0 bg-[var(--surface-0)]/45" />
        <div className="relative w-full max-w-[460px] rounded-2xl border border-[var(--surface-3)]/70 bg-[var(--surface-1)]/95 backdrop-blur-md shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)] p-7 sm:p-8 flex flex-col items-center text-center gap-4">
          {/* Service icon with a lock badge. */}
          <div className="relative flex items-center justify-center h-16 w-16 rounded-2xl bg-[var(--ps-yellow)]/12 border border-[var(--ps-yellow)]/35 text-[var(--accent-fg)]">
            <Icon size={26} />
            <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-0)] border border-[var(--surface-3)]">
              <Lock size={13} className="text-[var(--accent-fg)]" strokeWidth={2.5} />
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-fg)]">Not in your plan yet</span>
            <h2 className="text-[26px] font-bold tracking-tight text-[var(--text-primary)] leading-tight">{meta.label}</h2>
          </div>

          <p className="text-[13.5px] text-[var(--text-secondary)] leading-relaxed">{meta.pitch}</p>

          <ul className="flex flex-col gap-2 text-left w-full max-w-[370px]">
            {meta.benefits.map((b) => (
              <li key={b} className="flex items-start gap-2.5 text-[13px] text-[var(--text-secondary)]">
                <Check size={15} className="mt-0.5 shrink-0 text-[var(--accent-fg)]" strokeWidth={2.5} />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-1 w-full rounded-xl border border-[var(--ps-yellow)]/30 bg-[var(--ps-yellow)]/[0.06] px-4 py-3">
            <p className="text-[13.5px] font-semibold text-[var(--text-primary)]">Want this for your business?</p>
            <p className="text-[12.5px] text-[var(--text-secondary)] mt-0.5 leading-snug">
              Contact your Relay representative to add {meta.label}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
