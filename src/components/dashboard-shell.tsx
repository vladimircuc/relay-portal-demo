"use client";

/**
 * Top-level client wrapper for the dashboard body. Owns:
 *   - The TierProvider (Simple / Advanced state shared across the page)
 *   - The period strip (DateRangePicker + TierSelector at the top)
 *
 * Streaming sections are passed in as `children` (Suspense-wrapped server
 * components defined in the page).
 *
 * Date handling: we take "yyyy-MM-dd" strings (not ISO timestamps) and
 * parse them client-side to LOCAL-MIDNIGHT Date objects. This is the
 * key fix for the off-by-one display bug — a UTC-midnight Date sent
 * from the server gets interpreted in the user's local TZ and displays
 * as the previous day (e.g. Feb 19 UTC midnight shows as "Feb 18, 7 PM"
 * in Central). Constructing local-midnight from a date string keeps the
 * calendar date stable across the server-client boundary.
 */
import { format } from "date-fns";
import { DateRangePicker } from "./date-range-picker";
import { TierProvider } from "./tier-context";
import { TierSelector } from "./tier-selector";
import type { MetricTier } from "@/lib/types";

type Props = {
  initialTier: MetricTier;
  /** "yyyy-MM-dd" calendar date strings. */
  startStr: string;
  endStr: string;
  minDateStr: string;
  maxDateStr: string;
  compStartStr: string;
  compEndStr: string;
  children: React.ReactNode;
};

/**
 * Parse a "yyyy-MM-dd" calendar date to a Date object at LOCAL midnight
 * (not UTC midnight). Equivalent to `new Date(y, m-1, d)` — preserves the
 * calendar day in whatever timezone the browser is running in.
 *
 * Why not `new Date("yyyy-MM-dd")`? The native Date constructor parses
 * date-only strings as UTC midnight, which is exactly the trap we're
 * avoiding here.
 */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function DashboardShell({
  initialTier,
  startStr,
  endStr,
  minDateStr,
  maxDateStr,
  compStartStr,
  compEndStr,
  children,
}: Props) {
  const start = parseLocalDate(startStr);
  const end = parseLocalDate(endStr);
  const minDate = parseLocalDate(minDateStr);
  const maxDate = parseLocalDate(maxDateStr);
  const compStart = parseLocalDate(compStartStr);
  const compEnd = parseLocalDate(compEndStr);

  return (
    <TierProvider initialTier={initialTier}>
      <main className="w-full px-4 md:px-6 lg:px-12 py-6 md:py-10 flex flex-col gap-6 md:gap-8 lg:mx-auto lg:max-w-[90vw]">
        {/* Period picker + tier toggle. ViewModeToggle used to live here
            too (we A/B'd it against the header location), but the
            header placement won — it's now the single home of the
            Real-vs-Projected control. */}
        <section className="flex flex-wrap items-start justify-between gap-4">
          {/* `w-full md:w-auto` on the period block so the inner
              DateRangePicker button actually fills the screen on mobile.
              Without this the wrapping div shrinks to content width and
              the button never gets the room to expand. */}
          <div className="w-full md:w-auto">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
              Period
            </div>
            <DateRangePicker
              start={start}
              end={end}
              minDate={minDate}
              maxDate={maxDate}
              comparisonLabel={`vs ${format(compStart, "MMM d")} – ${format(compEnd, "MMM d, yyyy")}`}
            />
          </div>
          <TierSelector />
        </section>

        {children}
      </main>
    </TierProvider>
  );
}
