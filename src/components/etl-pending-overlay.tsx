"use client";

/**
 * Shared full-screen blocking overlay for in-flight ETL pulls.
 *
 * Used by:
 *   - <RefreshButton/> in the dashboard header (Refresh data)
 *   - <RunEtlButton/> on the per-client /admin → ETL Status section
 *     (Meta backfill, Asera sweep)
 *
 * Reasons for the blocker:
 *   - Pulls can take 30-60s. Without a visible "I'm working" indicator
 *     users assume the button broke and either click again (which the
 *     cooldown rejects but feels broken) or navigate away (which doesn't
 *     stop the server-side pull but leaves the in-flight etl_runs row
 *     orphaned with no completion logging from the UI side).
 *   - For admin actions specifically, navigating during a sweep can mean
 *     clicking around the admin and triggering DB queries that are
 *     contending with the active GHL upsert batch.
 *
 * Customisable copy + icon so each caller can identify what's pulling.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

type Props = {
  /** Heading text shown above the spinner. */
  title?: string;
  /** Second line of explanatory text. */
  subtitle?: string;
  /** Optional small icon (e.g. brand logo) shown inside the spinner ring. */
  centerIconSrc?: string;
  /** aria-label for screen readers when the overlay opens. */
  ariaLabel?: string;
};

export function EtlPendingOverlay({
  title = "Refreshing data",
  subtitle = "Pulling fresh numbers — this can take up to a minute.",
  centerIconSrc = "/brand/asera-icon.png",
  ariaLabel,
}: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel ?? title}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--surface-0)]/70 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-4 px-8 py-7 rounded-[var(--radius-card)] bg-[var(--surface-1)] border border-[var(--surface-3)]/60 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
        <div className="relative h-10 w-10">
          {centerIconSrc && (
            <span className="absolute inset-0 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={centerIconSrc}
                alt=""
                className="h-5 w-5 object-contain"
                aria-hidden
              />
            </span>
          )}
          <Loader2 size={40} className="animate-spin text-[var(--accent-fg)]" aria-hidden />
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </div>
          <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
            {subtitle}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
