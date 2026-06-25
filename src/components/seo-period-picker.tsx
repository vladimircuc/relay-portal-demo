"use client";

/**
 * Thin client wrapper around DateRangePicker for /seo. Mirrors
 * SocialsPeriodPicker: the page (server) only has calendar-date STRINGS, and
 * Date objects serialized server→client get reinterpreted in the user's local
 * TZ (off-by-one), so we parse to LOCAL-midnight here. Pins a SEO preset set +
 * the dedicated /seo period cookie so this range is independent of /ads + /socials.
 */
import { DateRangePicker, type PresetKey } from "./date-range-picker";
import { SEO_PERIOD_COOKIE } from "@/lib/prefs";

// SEO history runs long (≈16mo Search Console, GA4 retention, Bing max), so
// offer the wider shortcuts incl. "All time". The calendar covers custom spans.
const SEO_PRESETS: PresetKey[] = ["7d", "30d", "90d", "tm", "lm", "1y", "all"];

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function SeoPeriodPicker({
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
      presetKeys={SEO_PRESETS}
      cookieName={SEO_PERIOD_COOKIE}
      comparisonLabel={comparisonLabel}
    />
  );
}
