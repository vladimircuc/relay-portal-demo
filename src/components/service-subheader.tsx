import type { ReactNode } from "react";

/**
 * The slim per-service action bar that sits as a second row inside the sticky
 * DashboardHeader (Ads / Socials). "Status-led split bar" design: a live
 * data-freshness chip on the left, the service's controls on the right.
 *
 *   left   →  ● Live · Updated <when>   [ SOURCE <source> ]
 *   right  →  VIEW [viewToggle]   |   [actions]
 *
 * Controls are passed in (the real ViewModeToggle / RefreshButton /
 * SocialsConnectButton) so this component stays presentational.
 */
export function ServiceSubheader({
  updatedLabel,
  source,
  viewToggle,
  actions,
}: {
  /** Freshness stamp, already formatted (e.g. "Jun 11, 2:30 PM"). */
  updatedLabel?: string | null;
  /** Optional data-source tag (e.g. "Meta + Asera"). */
  source?: string | null;
  /** Optional Real·Projected toggle, prefixed with a "VIEW" label. */
  viewToggle?: ReactNode;
  /** Right-most action(s): Refresh, Connect Platform, … */
  actions?: ReactNode;
}) {
  return (
    <div className="w-full px-6 lg:px-12 h-12 flex items-center justify-between gap-4">
      {/* LEFT — live status */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)] whitespace-nowrap">
          <span className="relative inline-block w-[7px] h-[7px] shrink-0">
            <span className="absolute inset-0 rounded-full bg-[var(--positive)] opacity-60 animate-ping" />
            <span className="absolute inset-0 rounded-full bg-[var(--positive)]" />
          </span>
          <span className="font-semibold text-[var(--text-primary)] tracking-[-0.005em]">Live</span>
          {updatedLabel && (
            <>
              <span className="text-[var(--text-tertiary)]">·</span>
              <span>Updated {updatedLabel}</span>
            </>
          )}
        </span>
        {source && (
          <>
            <span className="w-px h-[18px] bg-[var(--surface-3)] shrink-0" aria-hidden />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] border border-[var(--surface-3)] px-2.5 py-[3px] whitespace-nowrap">
              <span className="text-[9.5px] font-semibold tracking-[0.09em] uppercase text-[var(--text-tertiary)]">Source</span>
              <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">{source}</span>
            </span>
          </>
        )}
      </div>

      {/* RIGHT — view toggle + actions */}
      <div className="flex items-center gap-3.5">
        {viewToggle && (
          <>
            <span className="text-[9.5px] font-semibold tracking-[0.1em] uppercase text-[var(--text-tertiary)]">
              View
            </span>
            {viewToggle}
          </>
        )}
        {viewToggle && actions && <span className="w-px h-5 bg-[var(--surface-3)] shrink-0" aria-hidden />}
        {actions}
      </div>
    </div>
  );
}
