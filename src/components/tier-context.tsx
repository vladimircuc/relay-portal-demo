"use client";

/**
 * React context for the dashboard tier (Simple / Advanced).
 *
 * Lives at the top of the dashboard tree (in DashboardShell). Consumers:
 *   - TierSelector (the toggle UI)
 *   - EfficiencyClient (varies which items it shows)
 *   - TierConditional (hides children when tier !== required)
 *
 * Tier state is purely client-side React state — the toggle is instant with
 * no server roundtrip. We also write to a cookie on every change so the
 * choice persists across visits.
 */
import { createContext, useContext, useState, useCallback } from "react";
import { writeTierCookie } from "@/lib/prefs";
import type { MetricTier } from "@/lib/types";

type TierContextValue = {
  tier: MetricTier;
  setTier: (t: MetricTier) => void;
};

const TierContext = createContext<TierContextValue | null>(null);

export function TierProvider({
  initialTier,
  children,
}: {
  initialTier: MetricTier;
  children: React.ReactNode;
}) {
  const [tier, setTierState] = useState<MetricTier>(initialTier);

  const setTier = useCallback((t: MetricTier) => {
    setTierState(t);
    writeTierCookie(t);
  }, []);

  return (
    <TierContext.Provider value={{ tier, setTier }}>
      {children}
    </TierContext.Provider>
  );
}

export function useTier(): TierContextValue {
  const ctx = useContext(TierContext);
  if (!ctx) throw new Error("useTier must be used within <TierProvider>");
  return ctx;
}
