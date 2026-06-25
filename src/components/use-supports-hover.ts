"use client";

/**
 * Hook for "does this device actually support hovering with a pointer?"
 *
 * Returns false during SSR / first render (so we don't render any
 * hover-specific UI before we know the viewport's capabilities), then
 * flips to the real `matchMedia('(hover: hover)').matches` value on
 * mount.
 *
 * Use this to gate JS-driven hover handlers — onMouseEnter that
 * triggers state changes, slice-dimming, trapezoid lifts, etc. On
 * touch devices these otherwise STICK after a tap (browser fires
 * synthetic mouse events on first tap, but never fires the matching
 * mouseleave until the user taps elsewhere), making the dashboard
 * look broken.
 *
 * Tailwind `hover:` styles are gated by the browser's media query
 * automatically in v4, so CSS-only hover effects are fine without
 * this hook. Only use it when JS state is involved.
 */
import { useEffect, useState } from "react";

export function useSupportsHover(): boolean {
  // Default to false so SSR + first paint matches touch behaviour.
  // After mount we check the actual capability and update.
  const [supports, setSupports] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover)");
    setSupports(mq.matches);
    // Listen for changes (e.g. a Surface that switches between
    // touch + trackpad modes mid-session).
    const onChange = (e: MediaQueryListEvent) => setSupports(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return supports;
}
