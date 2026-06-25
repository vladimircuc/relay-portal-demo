"use client";

/**
 * Global "navigation in progress" indicator + the small context that drives it.
 *
 * Two things in one file because they're tightly coupled:
 *
 *  - <NavProgressProvider>: holds a single boolean for "show the bar".
 *    Exposes `start()` / `stop()` (and a convenience `wrap(fn)` that runs
 *    a function with start/stop bookends).
 *
 *  - <TopProgress>: the actual yellow bar at the top of the viewport.
 *    Subscribes to the provider and auto-stops itself whenever the pathname
 *    settles to a new value (covers the `router.push()` case where we
 *    don't get an explicit stop signal).
 *
 * Usage:
 *   1. Mount <NavProgressProvider> high in the tree (root layout).
 *   2. Render <TopProgress /> once inside it.
 *   3. Anywhere you trigger a navigation (router.push) or a refresh
 *      (router.refresh inside startTransition), call useNavProgress().start()
 *      first. For refreshes you also explicitly call stop() once the
 *      transition's isPending becomes false.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Ctx = {
  active: boolean;
  start: () => void;
  stop: () => void;
  // Ref-counted "a <Link> navigation is in flight" signal, driven by
  // useLinkStatus() inside <ProgressLink>. Kept separate from start/stop so the
  // bar stays lit for the WHOLE navigation (until the destination renders),
  // independent of the pathname-settles auto-stop below — which fires while the
  // navigation is still pending and would otherwise kill the bar too early,
  // leaving the slow server round-trip with no feedback at all.
  addPending: () => void;
  removePending: () => void;
};

const NavProgressContext = createContext<Ctx>({
  active: false,
  start: () => {},
  stop: () => {},
  addPending: () => {},
  removePending: () => {},
});

export function NavProgressProvider({ children }: { children: React.ReactNode }) {
  // Manual start/stop bar — the router.push() / router.refresh() paths.
  const [manualActive, setManualActive] = useState(false);
  // Ref-count of in-flight <Link> navigations, driven by useLinkStatus() inside
  // <ProgressLink>. Held separately from manualActive so the bar stays lit for
  // the WHOLE navigation (until the destination renders), surviving the
  // pathname-settles auto-stop in <TopProgress> — see the Ctx comment above.
  const [pendingLinks, setPendingLinks] = useState(0);
  // Safety timer — if something forgets to stop, kill the manual bar. Sized to
  // match <ProgressLink>'s 20s useLinkStatus safety (progress-link.tsx) so a
  // legitimately slow navigation (a stale-session token refresh + cold caches
  // can run ~10s) keeps continuous feedback instead of the bar self-cancelling
  // mid-switch. The real stop is still prompt: TopProgress auto-stops on the
  // pathname change, and the <Link> pending signal clears when the destination
  // renders — this cap only matters when neither of those ever fires.
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    setManualActive(true);
    if (safetyRef.current) clearTimeout(safetyRef.current);
    safetyRef.current = setTimeout(() => setManualActive(false), 20000);
  }, []);

  const stop = useCallback(() => {
    setManualActive(false);
    if (safetyRef.current) {
      clearTimeout(safetyRef.current);
      safetyRef.current = null;
    }
  }, []);

  const addPending = useCallback(() => setPendingLinks((n) => n + 1), []);
  const removePending = useCallback(() => setPendingLinks((n) => Math.max(0, n - 1)), []);

  // Bar is visible if a manual nav is running OR any <Link> is mid-flight.
  const active = manualActive || pendingLinks > 0;

  return (
    <NavProgressContext.Provider value={{ active, start, stop, addPending, removePending }}>
      {children}
    </NavProgressContext.Provider>
  );
}

export function useNavProgress() {
  return useContext(NavProgressContext);
}

/**
 * The bar itself. Permanently mounted; just toggles opacity + animation via
 * the data-active attribute the CSS in globals.css reacts to.
 */
export function TopProgress() {
  const { active, stop } = useNavProgress();
  const pathname = usePathname();
  const prevPath = useRef(pathname);

  // Whenever the pathname has finished changing, the navigation is done —
  // auto-stop. Necessary because `router.push()` doesn't expose a "done"
  // event, but the resulting pathname update is a reliable signal.
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      stop();
    }
  }, [pathname, stop]);

  return (
    <div className="ps-progress" data-active={active ? "true" : "false"} aria-hidden>
      <span />
    </div>
  );
}
