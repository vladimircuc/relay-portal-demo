"use client";

import { useState } from "react";

const FAKE_TOKEN = "EAAGm0PX4ZCpsBO7q…ZB9ZBxr2yZBwZDZD";
const UUID = "7f3a1c20-9e44-4b1a-8c2e-1d9f0a6b5e10";

export function VaultRevokeDemo() {
  const [locked, setLocked] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; body: string } | null>(null);

  function call() {
    setResult(
      locked
        ? {
            ok: false,
            body: '{\n  "code": "42501",\n  "message": "permission denied for function admin_get_secret"\n}',
          }
        : { ok: true, body: `{\n  "admin_get_secret": "${FAKE_TOKEN}"\n}` },
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border p-5">
        <span className="inline-flex items-center gap-2 rounded-full border border-crit/40 bg-crit/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-crit">
          ● critical · found &amp; fixed
        </span>
        <h3 className="mt-3 text-base font-semibold tracking-tight">Vault REVOKE time-machine</h3>
        <p className="mt-1 max-w-2xl text-sm text-dim">
          An audit caught it: three secret-decryption functions had drifted to being callable by <em>anonymous</em>{" "}
          users — so anyone with the public key could decrypt every tenant&apos;s OAuth tokens. Flip the grant and call
          it as anon.
        </p>

        <div className="mt-4 inline-flex rounded-lg border border-border-2 p-1 text-xs">
          <button
            type="button"
            onClick={() => { setLocked(false); setResult(null); }}
            className={`rounded-md px-3 py-1.5 font-medium transition ${!locked ? "bg-crit/15 text-crit" : "text-dim"}`}
          >
            Drifted (anon allowed)
          </button>
          <button
            type="button"
            onClick={() => { setLocked(true); setResult(null); }}
            className={`rounded-md px-3 py-1.5 font-medium transition ${locked ? "bg-good/15 text-good" : "text-dim"}`}
          >
            Locked (migration 045)
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2">
        <div className="border-b border-border p-5 md:border-b-0 md:border-r">
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">request · as anon</div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-2 p-3 font-mono text-[11px] leading-relaxed text-dim">
{`POST /rest/v1/rpc/admin_get_secret
apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>

{ "secret_id": "${UUID}" }`}
          </pre>
          <button
            type="button"
            onClick={call}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
          >
            Call admin_get_secret() as anon
          </button>
        </div>

        <div className="p-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-faint">response</div>
          {result ? (
            <div className={`mt-2 rounded-lg border p-3 ${result.ok ? "border-crit/40 bg-crit/5" : "border-good/40 bg-good/5"}`}>
              <div className={`mb-1.5 font-mono text-[10px] uppercase tracking-wider ${result.ok ? "text-crit" : "text-good"}`}>
                {result.ok ? "200 · token leaked" : "403 · permission denied"}
              </div>
              <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-ink">{result.body}</pre>
            </div>
          ) : (
            <div className="mt-2 grid place-items-center rounded-lg border border-dashed border-border p-8 text-center text-xs text-faint">
              Run the request →
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border p-5">
        <div className="font-mono text-[10px] uppercase tracking-wider text-faint">the fix · grant diff</div>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-bg-2 p-3 font-mono text-[11px] leading-relaxed">
          <span className="text-crit">- GRANT ALL ON FUNCTION admin_get_secret(uuid) TO anon, authenticated;</span>
          {"\n"}
          <span className="text-good">+ REVOKE ALL ON FUNCTION admin_get_secret(uuid) FROM anon, authenticated;</span>
          {"\n"}
          <span className="text-good">+ GRANT EXECUTE ON FUNCTION admin_get_secret(uuid) TO service_role;</span>
        </pre>
        <p className="mt-3 text-xs leading-relaxed text-dim">
          The correct lockdown already existed in an earlier migration — this was a drift regression. A CI check now
          fails the build if any <code className="text-accent">SECURITY DEFINER</code> function is ever granted to anon
          or authenticated again.
        </p>
      </div>
    </div>
  );
}
