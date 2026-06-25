"use client";

/**
 * Shows its children only when the current tier matches `only`. Renders the
 * children mounted but visually hidden when tier doesn't match — so the
 * toggle is instant and any server-streamed content inside is kept alive.
 *
 * Use this around the Advanced-only sections (Performance, Projected).
 */
import { useTier } from "./tier-context";
import type { MetricTier } from "@/lib/types";

export function TierConditional({
  only,
  children,
}: {
  only: MetricTier;
  children: React.ReactNode;
}) {
  const { tier } = useTier();
  const visible = tier === only;
  // Advanced sections are ALSO hidden on mobile (only="advanced" check).
  // The mobile rule is: Simple view only, no exceptions.
  // We use a Tailwind class instead of viewport JS so SSR + first paint
  // is correct (no hydration flash).
  const mobileHide = only === "advanced";
  return (
    <div
      className={
        visible
          ? (mobileHide ? "hidden md:contents" : "contents")
          : "hidden"
      }
      aria-hidden={!visible}
    >
      {children}
    </div>
  );
}
