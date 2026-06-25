"use client";

/**
 * Theme-aware chart palettes for the recharts donuts (Source breakdown,
 * Content-type breakdown).
 *
 * recharts needs concrete color strings, not `var(--…)`, so we read the
 * `--chart-*` CSS variables off <html> at runtime and re-read whenever the
 * theme flips (the `theme` from useTheme is the dependency). On dark this
 * yields the historical yellow→gray ramp unchanged; on light it yields the
 * white-legible ramp defined in globals.css.
 *
 * The "Lost"-mode categorical palette is a JS constant (12 distinct hues, no
 * CSS var) and ships in two variants: pastels that pop on the dark surface,
 * and deeper saturated tones that hold contrast on a white card.
 */
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-context";

// Fallback = the dark ramp (matches the bare :root), used for SSR + the first
// client frame before the effect reads the live computed values.
const FALLBACK_RAMP = [
  "#ff6a00",
  "#f2f2f2",
  "#9c9c9c",
  "#6b6b6b",
  "#4a4a4a",
  "#3a3a3a",
];
const FALLBACK_OTHER = "#2a2a2a";

// "Lost" mode — one slice per reason, no "Other" rollup, no cap. A wide
// categorical ramp (cycles if a client has more reasons than entries).
const LOST_DARK = [
  "#ff6a00", // brand yellow
  "#f2f2f2", // off-white
  "#ff9f43", // amber
  "#5aa9e6", // steel blue
  "#ff6b6b", // coral
  "#63e6be", // teal
  "#b197fc", // lavender
  "#ffd8a8", // peach
  "#74c0fc", // sky
  "#ffa8a8", // rose
  "#8ce99a", // sage
  "#e599f7", // orchid
];
// Light variant — the dark pastels wash out on white, so these are deeper,
// saturated tones (and the off-white is swapped for near-black).
const LOST_LIGHT = [
  "#e6a700", // gold
  "#18181b", // near-black (was off-white)
  "#1c7ed6", // blue
  "#e8590c", // orange
  "#0ca678", // teal
  "#e03131", // red
  "#7048e8", // violet
  "#2f9e44", // green
  "#c2255c", // pink
  "#1098ad", // cyan
  "#f59f00", // amber
  "#9c36b5", // purple
];

export type ChartColors = {
  /** Sequential ramp (slice 0..n) for the source / content donuts. */
  ramp: string[];
  /** Color for the rolled-up "Other" slice. */
  other: string;
  /** Categorical palette for "Lost"-mode slices. */
  lost: string[];
};

export function useChartColors(): ChartColors {
  // Subscribe to theme so we re-read the vars + swap the lost palette on flip.
  const { theme } = useTheme();
  const [vars, setVars] = useState<{ ramp: string[]; other: string }>({
    ramp: FALLBACK_RAMP,
    other: FALLBACK_OTHER,
  });

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    setVars({
      ramp: FALLBACK_RAMP.map((fb, i) => read(`--chart-${i + 1}`, fb)),
      other: read("--chart-other", FALLBACK_OTHER),
    });
  }, [theme]);

  return {
    ...vars,
    lost: theme === "light" ? LOST_LIGHT : LOST_DARK,
  };
}
