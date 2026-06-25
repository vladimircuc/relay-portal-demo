"use client";

/**
 * "How projection works" modal for the projection feature.
 *
 * Opened from the small "How this is calculated" link on the
 * ProjectionBanner. Designed for a non-technical audience —
 * clients reading their own dashboard during a sales call, not
 * engineers debugging the math.
 *
 * Layout:
 *   1. One-sentence intro
 *   2. Visual chain showing the user's OWN numbers flowing through
 *      the projection step-by-step (outstanding → expected shows →
 *      expected conversions → projected revenue), with each step's
 *      rate inline between cards
 *   3. "Why we use the last 90 days" callout
 *   4. "What you'll see change" checklist
 *   5. Quick spotting-tip about the yellow underline
 *
 * Portals to document.body so the modal isn't constrained by any
 * parent overflow.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  BadgeCheck,
  Calendar,
  Sparkles,
  TrendingUp,
  UserCheck,
  X,
} from "lucide-react";
import type { FunnelLabels } from "@/lib/auth";
import { pluralize } from "@/lib/funnel-labels";

type Props = {
  outstanding: number;
  showRate: number;
  closeRate: number;
  avgRevPerConversion: number;
  windowDays: number;
  /** Per-client stage labels — used in the "what changes when you
   *  toggle on" checklist so the stage names match the rest of the
   *  dashboard. */
  labels: FunnelLabels;
  onClose: () => void;
};

export function ProjectionExplainer({
  outstanding,
  showRate,
  closeRate,
  avgRevPerConversion,
  windowDays,
  labels,
  onClose,
}: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Live worked example — same numbers the banner shows, threaded
  // through the chain so each step's value is the user's own.
  const expectedShows = outstanding * showRate;
  const expectedConversions = expectedShows * closeRate;
  const addedRevenue = expectedConversions * avgRevPerConversion;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="projection-explainer-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[var(--surface-0)]/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[560px] max-h-[85vh] overflow-y-auto bg-[var(--surface-1)] border border-[var(--surface-3)]/60 rounded-[var(--radius-card)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--surface-1)] border-b border-[var(--surface-3)]/40 px-6 py-4 flex items-center justify-between gap-3 z-10">
          <div className="flex items-center gap-2.5">
            <Sparkles size={18} className="text-[var(--accent-fg)]" />
            <h2
              id="projection-explainer-title"
              className="text-lg font-semibold text-[var(--text-primary)]"
            >
              How projection works
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-md flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-6">
          <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">Projected</strong>
            {" "}shows where you&apos;ll land if every appointment that&apos;s booked but hasn&apos;t
            happened yet plays out at the rates you usually see. Here&apos;s exactly how
            we&apos;re doing the math with your numbers right now:
          </p>

          {/* Visual chain — outstanding flowing through the funnel to
              projected revenue. Each step shows the count + a
              friendly icon; arrows in between explain the rate. */}
          <div className="flex flex-col gap-1">
            <Step
              icon={<Calendar size={18} />}
              value={formatN(outstanding)}
              label="Appointments still pending"
              accent
            />
            <Connector
              text={
                <>
                  Historically <strong>{formatPct(showRate)}</strong> of these will show up
                </>
              }
            />
            <Step
              icon={<UserCheck size={18} />}
              value={`~${formatN(expectedShows)}`}
              label="Expected to show up"
            />
            <Connector
              text={
                <>
                  Of those, <strong>{formatPct(closeRate)}</strong> typically become customers
                </>
              }
            />
            <Step
              icon={<BadgeCheck size={18} />}
              value={`~${formatN(expectedConversions)}`}
              label="Expected new customers"
            />
            <Connector
              text={
                <>
                  Each one is worth <strong>{formatCur(avgRevPerConversion)}</strong> on average
                </>
              }
            />
            <Step
              icon={<TrendingUp size={18} />}
              value={`~${formatCur(addedRevenue)}`}
              label="Extra projected revenue"
              accent
            />
          </div>

          {/* Why 90 days */}
          <Callout title={`Why we look at the last ${windowDays} days`}>
            If we only used the current view&apos;s numbers, a short period (like &quot;last 7
            days&quot;) might not have enough conversions to give a fair average. The last{" "}
            {windowDays} days give a steady benchmark to project from.
          </Callout>

          {/* What changes */}
          <div className="flex flex-col gap-2">
            <h3 className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] font-medium">
              When you toggle Projected on
            </h3>
            <ul className="flex flex-col gap-1.5 text-[13px] text-[var(--text-secondary)] leading-relaxed">
              <ChangeRow type="same">
                <strong className="text-[var(--text-primary)]">
                  Spend, Leads, {pluralize(labels.booking)}
                </strong>{" "}
                stay the same — these are already locked in
              </ChangeRow>
              <ChangeRow type="up">
                <strong className="text-[var(--text-primary)]">
                  {pluralize(labels.show)}, Conversions, Revenue
                </strong>{" "}
                grow with the projection
              </ChangeRow>
              <ChangeRow type="up">
                <strong className="text-[var(--text-primary)]">ROAS</strong> grows too (more revenue
                ÷ same spend)
              </ChangeRow>
              <ChangeRow type="up">
                <strong className="text-[var(--text-primary)]">
                  Cost per {labels.show.toLowerCase()} / per conversion
                </strong>{" "}
                improve (denominator grows)
              </ChangeRow>
            </ul>
          </div>

          {/* Spotting tip */}
          <Callout title="How to spot projected numbers">
            Anywhere on the dashboard, projected values get a small{" "}
            <span className="underline decoration-[var(--ps-yellow)] decoration-2 underline-offset-[3px] text-[var(--text-primary)]">
              yellow underline
            </span>{" "}
            so they&apos;re easy to tell apart from real, actuals-only numbers.
          </Callout>

          {/* Honest disclaimer */}
          <p className="text-[12px] text-[var(--text-tertiary)] leading-relaxed italic">
            This is a projection, not a guarantee. It assumes your next batch of appointments
            behaves like the last {windowDays} days on average. Slow weeks, end-of-quarter
            pushes, or seasonality aren&apos;t factored in.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual chain pieces

function Step({
  icon,
  value,
  label,
  accent,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  /** Highlight the first + last steps in yellow so the visual chain
   *  reads as "this starts here → and ends up at this". */
  accent?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center gap-4 px-4 py-3 rounded-md border " +
        (accent
          ? "bg-[var(--ps-yellow)]/10 border-[var(--ps-yellow)]/40"
          : "bg-[var(--surface-2)]/60 border-[var(--surface-3)]/60")
      }
    >
      <div
        className={
          "shrink-0 h-9 w-9 rounded-full flex items-center justify-center " +
          (accent
            ? "bg-[var(--ps-yellow)]/20 text-[var(--accent-fg)]"
            : "bg-[var(--surface-3)]/60 text-[var(--text-secondary)]")
        }
        aria-hidden
      >
        {icon}
      </div>
      <div className="flex flex-col min-w-0">
        <div className="text-[22px] font-bold tabular-nums leading-none text-[var(--text-primary)]">
          {value}
        </div>
        <div className="text-[11px] text-[var(--text-tertiary)] uppercase tracking-wider mt-1">
          {label}
        </div>
      </div>
    </div>
  );
}

function Connector({ text }: { text: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1 pl-4 text-[12px] text-[var(--text-tertiary)]">
      <ArrowDown size={14} className="shrink-0 text-[var(--text-secondary)]" />
      <span>{text}</span>
    </div>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-[var(--surface-2)]/50 border border-[var(--surface-3)]/40 p-4">
      <div className="text-[12px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium mb-1.5">
        {title}
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{children}</p>
    </div>
  );
}

function ChangeRow({
  type,
  children,
}: {
  type: "same" | "up";
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={
          "shrink-0 mt-0.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold " +
          (type === "up"
            ? "bg-[var(--positive)]/20 text-[var(--positive)]"
            : "bg-[var(--surface-3)]/60 text-[var(--text-tertiary)]")
        }
      >
        {type === "up" ? "↑" : "="}
      </span>
      <span>{children}</span>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Locally-scoped formatters (no Intl import overhead just for the modal)

function formatN(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
function formatPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}
function formatCur(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}
