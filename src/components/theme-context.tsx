"use client";

/**
 * Platform-wide light/dark theme context.
 *
 * The actual `data-theme` attribute is FIRST set by the pre-hydration script
 * in layout.tsx (cookie `ps_theme`, else OS `prefers-color-scheme`) so the
 * first paint is correct with no flash. This provider then:
 *   - mirrors that attribute into React state (so the toggle icon + any
 *     theme-aware client code re-render), and
 *   - owns flipping it, persisting the choice to the cookie, and running the
 *     premium circular-reveal transition.
 *
 * Mounted once, high in the tree (layout.tsx), so EVERY screen — dashboards,
 * login, no-access, legal — has a working toggle.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { writeThemeCookie, type Theme } from "@/lib/prefs";

// NOTE: `Document.startViewTransition` (and the `ViewTransition` return type)
// ship in the bundled DOM lib now, so we rely on those built-ins — a local
// `declare global` re-declaration would conflict with them. It's typed as an
// optional method, so the `!document.startViewTransition` guard below still
// narrows correctly for browsers that lack the API.

/** Where the reveal animation expands from (the toggle button's centre). */
export type RevealOrigin = { x: number; y: number };

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme, origin?: RevealOrigin) => void;
  toggleTheme: (origin?: RevealOrigin) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function currentDomTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR + first client render default to "dark" (matches the bare :root) — the
  // effect below immediately corrects it to whatever the pre-hydration script
  // already wrote to <html>. This avoids a hydration mismatch on the provider's
  // own markup (it renders none) while keeping the icon in sync post-mount.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(currentDomTheme());
  }, []);

  /** Commit a theme: DOM attribute + cookie + React state. */
  const apply = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    writeThemeCookie(next);
    setThemeState(next);
  }, []);

  const setTheme = useCallback(
    (next: Theme, origin?: RevealOrigin) => {
      if (typeof document === "undefined") return;

      const prefersReduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // No View Transitions support, reduced-motion, or no click origin →
      // just swap instantly. Everything still themes via the CSS vars.
      if (!document.startViewTransition || prefersReduced || !origin) {
        apply(next);
        return;
      }

      const root = document.documentElement;
      root.classList.add("theme-vt");
      const transition = document.startViewTransition(() => apply(next));

      transition.ready
        .then(() => {
          const { x, y } = origin;
          const endRadius = Math.hypot(
            Math.max(x, window.innerWidth - x),
            Math.max(y, window.innerHeight - y),
          );
          root.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 480,
              easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              pseudoElement: "::view-transition-new(root)",
            },
          );
        })
        .catch(() => {
          /* startViewTransition can reject if interrupted — theme already
             applied via the callback, so nothing to recover. */
        });

      transition.finished.finally(() => root.classList.remove("theme-vt"));
    },
    [apply],
  );

  const toggleTheme = useCallback(
    (origin?: RevealOrigin) => {
      setTheme(currentDomTheme() === "dark" ? "light" : "dark", origin);
    },
    [setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
