"use client";

import { Segmented } from "./ui/segmented";
import { useTier } from "./tier-context";
import type { MetricTier } from "@/lib/types";

const OPTIONS = [
  { value: "simple" as const,   label: "Simple" },
  { value: "advanced" as const, label: "Advanced" },
];

export function TierSelector() {
  const { tier, setTier } = useTier();
  // Hidden on mobile per the simplified mobile UX rule: Simple view only
  // (the Advanced sections themselves are also hidden on mobile elsewhere,
  // so the toggle would be a no-op).
  return (
    <div className="hidden md:block">
      <Segmented<MetricTier>
        value={tier}
        options={OPTIONS}
        onChange={setTier}
        size="sm"
      />
    </div>
  );
}
