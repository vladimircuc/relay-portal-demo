import Image from "next/image";
import type { ReactNode } from "react";

export function Logo({ size = 30, word = false }: { size?: number; word?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="inline-block overflow-hidden rounded-lg ring-1 ring-border-2"
        style={{ width: size, height: size }}
      >
        <Image
          src="/relay-logo.png"
          alt="Relay"
          width={size}
          height={size}
          className="h-full w-full object-cover"
          priority
        />
      </span>
      {word && <span className="text-sm font-semibold tracking-tight">Relay</span>}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Delta({ value, invert = false }: { value: number; invert?: boolean }) {
  if (!value) return <span className="text-xs text-faint">—</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? "text-good" : "text-crit"}`}>
      {up ? "▲" : "▼"} {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

export function Stat({
  label,
  value,
  delta,
  invert,
  sub,
}: {
  label: string;
  value: string;
  delta?: number;
  invert?: boolean;
  sub?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-xs text-dim">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {delta !== undefined && <Delta value={delta} invert={invert} />}
      </div>
      {sub && <div className="mt-1 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export function SectionTitle({ kicker, title, action }: { kicker?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        {kicker && <p className="kicker">{kicker}</p>}
        <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  );
}
