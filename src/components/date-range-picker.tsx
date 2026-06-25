"use client";

/**
 * Period selector — click-by-click range picker.
 *
 * Selection model:
 *   - State machine with two phases: "first" (waiting for the first click)
 *     and "second" (waiting for the closing click).
 *   - 1st click: stores the anchor, collapses the visible range to that day.
 *   - 2nd click: finalizes the range. If clicked date < anchor, it becomes
 *     the new start; otherwise it's the new end. Either way you get a valid
 *     range without thinking about order.
 *   - 3rd click: anchor again. Range is cleared and the cycle restarts.
 *
 * Hovering during the "second" phase shows a live preview of the range
 * (anchor → hovered day), so you can see what you're about to pick.
 *
 * Month/year dropdowns let you jump anywhere within [minDate, maxDate] in
 * a single click instead of arrow-clicking through months.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import {
  format,
  isAfter,
  isBefore,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  subQuarters,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";
import { Calendar, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { writePeriodCookie } from "@/lib/prefs";
import { useNavProgress } from "./nav-progress";

type Props = {
  start: Date;
  end: Date;
  minDate: Date;
  maxDate: Date;
  comparisonLabel?: string;
  /** Which shortcut presets to show, in order. Defaults to the /ads set.
   *  /socials passes the Plannable set (quarters / years). */
  presetKeys?: PresetKey[];
  /** Cookie to persist the chosen range into. Defaults to the shared
   *  ps_period; /socials passes its own so the two sections stay independent. */
  cookieName?: string;
};

// All available shortcuts + their date math. `range(max, min)` returns
// [from, to]; callers clamp to [minDate, maxDate].
const PRESET_DEFS: Record<string, { label: string; range: (max: Date, min: Date) => [Date, Date] }> = {
  "7d":  { label: "Last 7 days",  range: (max) => [subDays(max, 6), max] },
  "30d": { label: "Last 30 days", range: (max) => [subDays(max, 29), max] },
  "90d": { label: "Last 90 days", range: (max) => [subDays(max, 89), max] },
  "tm":  { label: "This month",   range: (max) => [startOfMonth(max), max] },
  "lm":  { label: "Last month",   range: (max) => [startOfMonth(subMonths(max, 1)), endOfMonth(subMonths(max, 1))] },
  "tq":  { label: "This quarter", range: (max) => [startOfQuarter(max), max] },
  "lq":  { label: "Last quarter", range: (max) => [startOfQuarter(subQuarters(max, 1)), endOfQuarter(subQuarters(max, 1))] },
  "ty":  { label: "This year",    range: (max) => [startOfYear(max), max] },
  "1y":  { label: "1 year",       range: (max) => [subDays(max, 364), max] },
  "all": { label: "All time",     range: (max, min) => [min, max] },
};
export type PresetKey = keyof typeof PRESET_DEFS;

const DEFAULT_PRESET_KEYS: PresetKey[] = ["7d", "30d", "90d", "tm", "lm", "all"];

export function DateRangePicker({ start, end, minDate, maxDate, comparisonLabel, presetKeys = DEFAULT_PRESET_KEYS, cookieName }: Props) {
  const router = useRouter();
  // Wrap router.refresh in a transition so existing UI stays rendered with
  // OLD data while the new period's data streams in — no flash to skeleton.
  const [isPending, startTransition] = useTransition();
  const nav = useNavProgress();

  // Mirror the transition's pending state to the global top progress bar
  // so the user gets feedback at the very top of the viewport, not just on
  // the picker trigger.
  useEffect(() => {
    if (isPending) nav.start();
    else nav.stop();
  }, [isPending, nav]);

  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<Date>(start);
  const [draftEnd, setDraftEnd] = useState<Date>(end);

  // Click state machine — "first" waits for the anchor click; "second" waits
  // for the closing click that finalizes the range.
  const [phase, setPhase] = useState<"first" | "second">("first");
  const [anchor, setAnchor] = useState<Date | null>(null);
  // Live hover preview during the "second" phase
  const [hoverDay, setHoverDay] = useState<Date | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync draft + reset state when the URL-driven start/end change
  useEffect(() => {
    setDraftStart(start);
    setDraftEnd(end);
    setPhase("first");
    setAnchor(null);
    setHoverDay(null);
  }, [start.getTime(), end.getTime()]);

  // Click-outside-to-close
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        cancel();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  function clamp(d: Date): Date {
    if (isBefore(d, minDate)) return minDate;
    if (isAfter(d, maxDate))  return maxDate;
    return d;
  }

  function handleDayClick(day: Date) {
    const clamped = clamp(day);
    if (phase === "first") {
      // First click — set the anchor, collapse range visually to that day.
      setAnchor(clamped);
      setDraftStart(clamped);
      setDraftEnd(clamped);
      setHoverDay(null);
      setPhase("second");
    } else if (anchor) {
      // Second click — order anchor and clicked day to form a valid range.
      const [from, to] = isBefore(clamped, anchor)
        ? [clamped, anchor]
        : [anchor, clamped];
      setDraftStart(from);
      setDraftEnd(to);
      setAnchor(null);
      setHoverDay(null);
      setPhase("first");
    }
  }

  function applyRange(from: Date, to: Date) {
    const cf = clamp(from);
    const ct = clamp(to);
    // Persist the chosen range as a cookie so it's remembered across visits.
    writePeriodCookie(format(cf, "yyyy-MM-dd"), format(ct, "yyyy-MM-dd"), cookieName);
    // Wrapping refresh() in startTransition is what gives the optimistic
    // feel: React keeps the OLD rendered tree on screen while the new data
    // streams in. Suspense fallbacks DON'T flash during a transition.
    startTransition(() => router.refresh());
    setOpen(false);
    setPhase("first");
    setAnchor(null);
    setHoverDay(null);
  }

  function applyPreset(key: PresetKey) {
    const [from, to] = PRESET_DEFS[key].range(maxDate, minDate);
    applyRange(from, to);
  }

  function cancel() {
    setDraftStart(start);
    setDraftEnd(end);
    setPhase("first");
    setAnchor(null);
    setHoverDay(null);
    setOpen(false);
  }

  // Visual range:
  //   - In "first" phase → the committed draft range.
  //   - In "second" phase with hover → live preview (anchor → hovered day).
  //   - In "second" phase without hover → just the anchor day (collapsed).
  let visStart: Date;
  let visEnd: Date;
  if (phase === "second" && anchor) {
    if (hoverDay) {
      [visStart, visEnd] = isBefore(hoverDay, anchor)
        ? [hoverDay, anchor]
        : [anchor, hoverDay];
    } else {
      visStart = anchor;
      visEnd = anchor;
    }
  } else {
    visStart = draftStart;
    visEnd = draftEnd;
  }
  const isCollapsed = visStart.getTime() === visEnd.getTime();

  return (
    <div ref={containerRef} className="relative flex flex-col items-stretch md:inline-flex md:items-start w-full md:w-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          // Full width on mobile so it fills the screen / period bar
          // instead of sitting at half-width. Inline on desktop.
          "flex w-full md:w-auto md:inline-flex items-center gap-2.5 rounded-lg border border-[var(--surface-3)]/60 bg-[var(--surface-1)] px-4 py-2.5",
          "text-[15px] font-semibold tabular-nums text-[var(--text-primary)]",
          "hover:bg-[var(--surface-2)] transition-colors",
          // Subtle pulse on the trigger while we're refreshing in the
          // background — the rest of the dashboard keeps showing old data.
          isPending && "ring-2 ring-[var(--ps-yellow)]/40 animate-pulse",
        )}
      >
        <Calendar size={15} className="text-[var(--text-secondary)]" />
        {/* Mobile: compact label, no years (the period bar is already
            cramped on a 375px screen). Desktop: full "Feb 26, 2026 →
            May 26, 2026" since there's room. */}
        <span className="md:hidden">
          {format(start, "MMM d")} – {format(end, "MMM d")}
        </span>
        <span className="hidden md:inline">{format(start, "MMM d, yyyy")}</span>
        <span className="hidden md:inline text-[var(--text-tertiary)]">→</span>
        <span className="hidden md:inline">{format(end, "MMM d, yyyy")}</span>
        {/* Chevron flush-right on mobile (the button fills the screen
            so the empty space goes between the date and the chevron),
            tight against the date on desktop. */}
        <ChevronDown size={14} className="text-[var(--text-tertiary)] ml-auto md:ml-1" />
      </button>

      <div className="text-[11px] text-[var(--text-tertiary)] mt-1.5 ml-1 flex items-center gap-2 flex-wrap">
        {comparisonLabel && <span>{comparisonLabel}</span>}
        {comparisonLabel && <span className="text-[var(--surface-3)]">·</span>}
        <span>Data starts {format(minDate, "MMM d, yyyy")}</span>
      </div>

      {open && (
        <div
          className={cn(
            "absolute left-0 top-full mt-2 z-50",
            "bg-[var(--surface-1)] border border-[var(--surface-3)]/60 rounded-[var(--radius-card)]",
            "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]",
            "flex",
          )}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Preset rail — only column on mobile; left side on desktop.
              On mobile, the right border (which separates from the calendar)
              is removed since the calendar is hidden. */}
          <div className="flex flex-col gap-1 p-3 md:border-r md:border-[var(--surface-3)]/60 min-w-[180px] md:min-w-[160px]">
            <div className="px-2 pb-2 text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
              Shortcuts
            </div>
            {presetKeys.map((key) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className="text-left px-3 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
              >
                {PRESET_DEFS[key].label}
              </button>
            ))}
          </div>

          {/* Calendar + actions — hidden on mobile; on mobile the user
              picks a preset and we close the picker. */}
          <div className="hidden md:flex p-3 flex-col gap-3">
            <DayPicker
              mode="single"
              // We manage range visualization via modifiers, so don't bind
              // the controlled selection to a date — keep it undefined and
              // ignore the built-in onSelect.
              selected={undefined}
              onSelect={() => {}}
              onDayClick={handleDayClick}
              onDayMouseEnter={(day) => phase === "second" && setHoverDay(day)}
              onDayMouseLeave={() => phase === "second" && setHoverDay(null)}
              numberOfMonths={2}
              defaultMonth={subMonths(end, 1)}
              disabled={[{ before: minDate }, { after: maxDate }]}
              showOutsideDays={false}
              weekStartsOn={0}
              // "label" renders "October 2026" as plain text above the
              // date grid, plus the < > nav arrows. We tried "dropdown"
              // earlier (two <select>s for month + year) but the selects
              // rendered invisible after Vercel deploy — likely a CSS
              // load-order issue with Turbopack. Label is bulletproof.
              captionLayout="label"
              startMonth={minDate}
              endMonth={maxDate}
              className="ps-calendar"
              modifiers={{
                rangeStart: visStart,
                rangeEnd: visEnd,
                // Function matcher (instead of `{ after, before }`) so we can
                // explicitly return false when the range is collapsed —
                // otherwise the lib's interval matcher could mistakenly paint
                // the whole calendar after the first click.
                rangeMiddle: (day: Date) => {
                  if (isCollapsed) return false;
                  return isAfter(day, visStart) && isBefore(day, visEnd);
                },
              }}
              modifiersClassNames={{
                rangeStart: "rdp-range_start rdp-selected",
                rangeEnd: "rdp-range_end rdp-selected",
                rangeMiddle: "rdp-range_middle",
              }}
            />

            <div className="flex items-center justify-between gap-3 px-2 pt-2 border-t border-[var(--surface-3)]/40">
              <div className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
                {phase === "second" ? (
                  <span className="text-[var(--accent-fg)] font-medium">
                    Click another day to set the range
                  </span>
                ) : (
                  <span className="text-[var(--text-secondary)] font-medium">
                    {format(draftStart, "MMM d")} – {format(draftEnd, "MMM d, yyyy")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancel}
                  className="text-[13px] px-3 py-1.5 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => applyRange(draftStart, draftEnd)}
                  disabled={phase === "second"}
                  className={cn(
                    "text-[13px] px-3 py-1.5 rounded-md font-medium transition-colors",
                    phase === "second"
                      ? "bg-[var(--surface-2)] text-[var(--text-tertiary)] cursor-not-allowed"
                      : "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)]",
                  )}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
