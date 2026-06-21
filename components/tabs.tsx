"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ClientTabs({ slug, tabs }: { slug: string; tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const href = `/c/${slug}${t.href}`;
        const active = path === href;
        return (
          <Link
            key={t.href}
            href={href}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition ${
              active ? "border-accent text-ink" : "border-transparent text-dim hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
