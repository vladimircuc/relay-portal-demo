// Lightweight, dependency-free SVG charts — full control over theming, no recharts.

export function AreaTrend({
  data,
  height = 72,
  stroke = "var(--color-accent)",
}: {
  data: number[];
  height?: number;
  stroke?: string;
}) {
  const w = 320;
  const h = height;
  const pad = 5;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  const id = `at-${data.length}-${Math.round(min)}-${Math.round(max)}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MiniSpark({ data, stroke = "var(--color-accent)" }: { data: number[]; stroke?: string }) {
  const w = 80;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const line = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-20" style={{ height: h }}>
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FunnelBars({ steps }: { steps: { label: string; value: number }[] }) {
  const max = steps[0]?.value || 1;
  return (
    <div className="grid gap-3">
      {steps.map((s, i) => {
        const width = Math.max(5, (s.value / max) * 100);
        const conv = i === 0 ? null : s.value / steps[i - 1].value;
        return (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-dim">{s.label}</span>
              <span className="font-medium text-ink">
                {s.value.toLocaleString()}
                {conv !== null && <span className="ml-2 text-faint">{(conv * 100).toFixed(0)}%</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full"
                style={{ width: `${width}%`, background: "linear-gradient(90deg,#ff8a3d,var(--color-accent-2))" }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Donut({ value, label }: { value: number; label: string }) {
  // value 0..1
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = Math.min(1, Math.max(0, value)) * c;
  return (
    <div className="flex items-center gap-4">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth="9" />
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 44 44)"
        />
        <text x="44" y="49" textAnchor="middle" className="fill-ink" style={{ fontSize: 16, fontWeight: 600 }}>
          {Math.round(value * 100)}%
        </text>
      </svg>
      <div className="text-sm text-dim">{label}</div>
    </div>
  );
}
