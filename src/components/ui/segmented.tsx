"use client";

/** Segmented control — used for tier switcher (Simple/Standard/Advanced)
 *  and other small mutually-exclusive choice groups. Pure client component. */
import { cn } from "@/lib/cn";
import { useState } from "react";

type Option<T extends string> = { value: T; label: string; count?: number };

type Props<T extends string> = {
  value?: T;
  defaultValue?: T;
  options: Option<T>[];
  onChange?: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
};

export function Segmented<T extends string>({
  value,
  defaultValue,
  options,
  onChange,
  className,
  size = "md",
}: Props<T>) {
  const [internal, setInternal] = useState<T>(defaultValue ?? options[0].value);
  const current = value ?? internal;

  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 p-1 rounded-lg",
        "bg-[var(--surface-1)] border border-[var(--surface-3)]/60",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => {
              setInternal(opt.value);
              onChange?.(opt.value);
            }}
            className={cn(
              "rounded-md transition-colors font-medium",
              size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-sm",
              active
                ? "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            {opt.label}
            {opt.count != null && (
              <span className="ml-1.5 text-[0.8em] tabular-nums opacity-60">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
