"use client";

/**
 * Segmented control bound to the global Real-vs-Projected view mode.
 *
 * Rendered in two places by design (period bar AND header) for an
 * A/B-style placement test — both instances read & write the same
 * `useViewMode()` context, so flipping either updates the dashboard
 * in lockstep. Once we pick a winner we can drop one location.
 */
import { Segmented } from "./ui/segmented";
import { useViewMode } from "./view-mode-context";
import type { ViewMode } from "@/lib/prefs";

const OPTIONS = [
  { value: "real" as const,      label: "Real" },
  { value: "projected" as const, label: "Projected" },
];

export function ViewModeToggle({ size = "sm" }: { size?: "sm" | "md" }) {
  const { viewMode, setViewMode } = useViewMode();
  return (
    <Segmented<ViewMode>
      value={viewMode}
      options={OPTIONS}
      onChange={setViewMode}
      size={size}
    />
  );
}
