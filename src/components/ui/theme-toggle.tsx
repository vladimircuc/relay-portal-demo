"use client";

/**
 * Light/dark theme toggle — a clean square icon button. Sun in dark mode
 * (click to go light), moon in light mode (click to go dark). The two glyphs
 * cross-fade with a rotate+scale so the swap feels premium; the actual page
 * theme change is the circular reveal driven by ThemeProvider.
 *
 * Styling follows the platform toggle taste: solid surfaces, NO glow/shadow.
 * Lives in every header's right cluster, and as a fixed corner button on the
 * header-less pages (login / no-access / legal) via <FixedThemeToggle>.
 */
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme } from "@/components/theme-context";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={!isDark}
      title={isDark ? "Light mode" : "Dark mode"}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg",
        "border border-[var(--surface-3)] bg-[var(--surface-1)] text-[var(--text-secondary)]",
        "transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]",
        className,
      )}
    >
      {/* Both icons stacked; opacity + rotate/scale toggles which is shown. */}
      <Sun
        size={18}
        strokeWidth={2}
        className={cn(
          "absolute transition-all duration-300 ease-out motion-reduce:transition-none",
          isDark
            ? "rotate-0 scale-100 opacity-100"
            : "-rotate-90 scale-50 opacity-0",
        )}
      />
      <Moon
        size={18}
        strokeWidth={2}
        className={cn(
          "absolute transition-all duration-300 ease-out motion-reduce:transition-none",
          isDark
            ? "rotate-90 scale-50 opacity-0"
            : "rotate-0 scale-100 opacity-100",
        )}
      />
    </button>
  );
}

/**
 * Fixed top-right variant for screens with no header (login, no-access,
 * privacy, terms). Sits above page content and clears notches via env() safe
 * area insets.
 */
export function FixedThemeToggle({ className }: { className?: string }) {
  return (
    <div
      className={cn("fixed right-4 top-4 z-50", className)}
      style={{
        right: "max(1rem, env(safe-area-inset-right))",
        top: "max(1rem, env(safe-area-inset-top))",
      }}
    >
      <ThemeToggle />
    </div>
  );
}
