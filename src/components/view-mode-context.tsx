"use client";

/**
 * React context for the Real-vs-Projected view mode.
 *
 * Lives at the top of the dashboard tree, alongside TierProvider.
 * Consumers:
 *   - ViewModeToggle (the segmented control, rendered in two places —
 *     period bar AND header — both bound to this state for the
 *     placement A/B)
 *   - Every section client component that varies its display by mode
 *     (Hero, Funnel, SourceBreakdown, EfficiencyClient, projection
 *     banner, etc.)
 *
 * State is purely client-side React state — toggle is instant with no
 * server roundtrip (server pre-fetches both actuals + projection rates
 * on every page load, so each section already has everything it needs
 * to render either mode). We also write to a cookie on every change so
 * the choice persists across page navigations.
 */
import { createContext, useContext, useState, useCallback } from "react";
import { writeViewModeCookie, type ViewMode } from "@/lib/prefs";

type ViewModeContextValue = {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
};

const ViewModeContext = createContext<ViewModeContextValue | null>(null);

export function ViewModeProvider({
  initialMode,
  children,
}: {
  initialMode: ViewMode;
  children: React.ReactNode;
}) {
  const [viewMode, setMode] = useState<ViewMode>(initialMode);

  const setViewMode = useCallback((m: ViewMode) => {
    setMode(m);
    writeViewModeCookie(m);
  }, []);

  return (
    <ViewModeContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </ViewModeContext.Provider>
  );
}

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error("useViewMode must be used within <ViewModeProvider>");
  return ctx;
}
