"use client";

/**
 * Thin client wrapper around DateRangePicker for /socials.
 *
 * Why a wrapper: the page (server component) only has calendar-date STRINGS,
 * and Date objects serialized server→client get reinterpreted in the user's
 * local TZ (off-by-one). So we take strings and parse them to LOCAL-midnight
 * here on the client — same trick as DashboardShell on /ads.
 *
 * It also pins the Plannable preset set + the dedicated /socials period cookie
 * so this section's range is independent of /ads.
 */
import { DateRangePicker, type PresetKey } from "./date-range-picker";
import { SOCIALS_PERIOD_COOKIE } from "@/lib/prefs";

// Plannable's shortcut set — no "Custom range" item; the calendar's 2-day
// click already covers custom selection.
const SOCIALS_PRESETS: PresetKey[] = ["7d", "30d", "tm", "lm", "tq", "lq", "ty", "1y"];

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function SocialsPeriodPicker({
  startStr,
  endStr,
  minDateStr,
  maxDateStr,
  comparisonLabel,
}: {
  startStr: string;
  endStr: string;
  minDateStr: string;
  maxDateStr: string;
  comparisonLabel?: string;
}) {
  return (
    <DateRangePicker
      start={parseLocalDate(startStr)}
      end={parseLocalDate(endStr)}
      minDate={parseLocalDate(minDateStr)}
      maxDate={parseLocalDate(maxDateStr)}
      presetKeys={SOCIALS_PRESETS}
      cookieName={SOCIALS_PERIOD_COOKIE}
      comparisonLabel={comparisonLabel}
    />
  );
}
