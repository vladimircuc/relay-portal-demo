"use client";

import { useState } from "react";

const TENANTS = [
  { id: "acme", label: "Acme Dental — your tenant", allowed: true },
  { id: "globex", label: "Globex Legal — another tenant", allowed: false },
];

export function RlsProbeDemo() {
  const [target, setTarget] = useState("acme");
  const [result, setResult] = useState<{ ok: boolean; rows: number } | null>(null);
  const t = TENANTS.find((x) => x.id === target) ?? TENANTS[0];

  function run() {
    setResult({ ok: t.allowed, rows: t.allowed ? 42 : 0 });
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border p-5">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-accent">
          rls · tenant isolation
        </span>
        <h3 className="mt-3 text-base font-semibold tracking-tight">Cross-tenant fetch wall</h3>
        <p className="mt-1 max-w-2xl text-sm text-dim">
          You&apos;re signed in as <code className="text-ink">viewer@acme.com</code>. Your token resolves to{" "}
          <code className="text-accent">accessible_client_ids() = [acme]</code>. Try to read another tenant&apos;s rows
          by changing the client_id.
        </p>
      </div>

      <div className="grid md:grid-cols-2">
        <div className="border-b border-border p-5 md:border-b-0 md:border-r">
          <label className="font-mono text-[10px] uppercase tracking-wider text-faint">target tenant</label>
          <select
            value={target}
            onChange={(e) => { setTarget(e.target.value); setResult(null); }}
            className="mt-2 w-full rounded-lg border border-border-2 bg-bg-2 px-3 py-2 text-sm"
          >
            {TENANTS.map((tn) => (
              <option key={tn.id} value={tn.id}>{tn.label}</option>
            ))}
          </select>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-bg-2 p-3 font-mono text-[11px] text-dim">
{`GET /rest/v1/leads?client_id=eq.${target}`}
          </pre>
          <button
            type="button"
            onClick={run}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
          >
            Fetch rows
          </button>
        </div>

        <div className="p-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">response</div>
          {result ? (
            <div className={`mt-2 rounded-lg border p-3 ${result.ok ? "border-good/40 bg-good/5" : "border-crit/40 bg-crit/5"}`}>
              <div className={`mb-1.5 font-mono text-[10px] uppercase tracking-wider ${result.ok ? "text-good" : "text-crit"}`}>
                200 OK · {result.rows} rows
              </div>
              <p className="text-xs leading-relaxed text-dim">
                {result.ok
                  ? "Your own tenant — the rows come back."
                  : "Blocked. RLS filtered every row: the policy is client_id IN (accessible_client_ids()), and yours doesn't include this tenant. The database refused, not the app — and it returns an empty set rather than an error, so it never even confirms the rows exist."}
              </p>
            </div>
          ) : (
            <div className="mt-2 grid place-items-center rounded-lg border border-dashed border-border p-8 text-center text-xs text-faint">
              Fetch to see the result →
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
