"use client";

/**
 * Demo 2 — OAuth state forgery, defended by an HMAC-SHA256 signed state.
 *
 * Faithful to the real app's signState()/verifyState(): the connect flow signs
 * `clientId.returnTo.timestamp` with the platform app secret (HMAC-SHA256, 64
 * hex chars) and the callback recomputes it and compares in constant time, with
 * a 10-minute TTL. An attacker can't re-sign a tampered payload without the
 * server-only secret, so swapping the clientId or replaying an old state fails.
 *
 * The HMAC here is computed live in the browser with Web Crypto over a clearly
 * labelled DEMO secret — same algorithm, same verification order as production.
 */
import { useEffect, useState } from "react";
import { KeyRound, CheckCircle2, Ban, Send, RotateCcw } from "lucide-react";

const DEMO_SECRET = "demo-meta-app-secret (server-only · never shipped to the browser)";
const TTL_MS = 600_000; // 10 minutes, as in the real verifyState()

type Scenario = "none" | "swap" | "replay";
type Computed = { clientId: string; ts: number; ageMin: number; expired: boolean; sig: string; expected: string };

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function OAuthForgeryDemo() {
  const [scenario, setScenario] = useState<Scenario>("swap");
  const [c, setC] = useState<Computed | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Recompute the issued state + the server's recomputed HMAC whenever the
  // chosen attack changes. The legit state is always issued for Brightside;
  // the attacker tampers the payload but keeps the original signature.
  // `expired` is decided here (once, off a captured clock) so render stays pure.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const now = Date.now();
      const issuedTs = scenario === "replay" ? now - 11 * 60_000 : now; // replay = an 11-min-old state
      const expired = now - issuedTs > TTL_MS;
      const issuedPayload = `brightside-dental.admin.${issuedTs}`;
      const sig = await hmacHex(DEMO_SECRET, issuedPayload); // attacker holds this; can't change it
      const submittedClientId = scenario === "swap" ? "apex-law" : "brightside-dental";
      const expected = await hmacHex(DEMO_SECRET, `${submittedClientId}.admin.${issuedTs}`);
      if (cancelled) return;
      setSubmitted(false);
      setC({ clientId: submittedClientId, ts: issuedTs, ageMin: Math.round((now - issuedTs) / 60_000), expired, sig, expected });
    })();
    return () => { cancelled = true; };
  }, [scenario]);

  const verdict = (() => {
    if (!c) return null;
    if (c.expired) return { ok: false, reason: "State expired", detail: "timestamp older than the 10-minute TTL" };
    if (c.sig !== c.expected) return { ok: false, reason: "Bad signature", detail: "recomputed HMAC ≠ the state's signature" };
    return { ok: true as const, reason: "Verified", detail: "signature matches and the state is fresh" };
  })();

  const swapped = scenario === "swap";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-[var(--text-tertiary)]">Attacker move:</span>
        <Seg active={scenario === "none"} onClick={() => setScenario("none")}>None (legit)</Seg>
        <Seg active={scenario === "swap"} onClick={() => setScenario("swap")}>Swap clientId → Apex</Seg>
        <Seg active={scenario === "replay"} onClick={() => setScenario("replay")}>Replay 11-min-old state</Seg>
      </div>

      {/* The forged callback */}
      <div className="rounded-md border border-[var(--surface-3)]/50 bg-[var(--surface-0)] px-4 py-3">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Incoming callback</div>
        <div className="overflow-x-auto font-mono text-[12px] leading-relaxed text-[var(--text-secondary)]">
          <span className="text-[var(--text-tertiary)]">GET</span> /api/auth/meta/callback?code=<span className="text-[var(--text-tertiary)]">…</span>&amp;state=
          {c ? (
            <span className="whitespace-nowrap">
              <span className={swapped ? "seclab-flash rounded px-0.5 font-semibold text-[var(--negative)]" : "text-[var(--text-primary)]"}>{c.clientId}</span>
              <span className="text-[var(--text-tertiary)]">.admin.{c.ts}.</span>
              <span className="text-[var(--text-secondary)]">{c.sig.slice(0, 24)}…</span>
            </span>
          ) : (
            <span className="text-[var(--text-tertiary)]">computing…</span>
          )}
        </div>
        {swapped && (
          <div className="mt-2 text-[11px] text-[var(--negative)]">↑ clientId tampered to another tenant — but the attacker can&apos;t re-sign it without the server secret.</div>
        )}
      </div>

      {/* Verify panel */}
      {!submitted ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-tertiary)]">
            <KeyRound size={13} className="text-[var(--accent-fg)]" />
            Signing key: <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10.5px]">{DEMO_SECRET}</code>
          </div>
          <button
            onClick={() => setSubmitted(true)}
            disabled={!c}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--ps-yellow)] px-4 text-[13px] font-semibold text-[var(--text-on-yellow)] transition-[filter] hover:brightness-95 disabled:opacity-50"
          >
            <Send size={14} /> Submit to callback
          </button>
        </div>
      ) : (
        c && verdict && (
          <div className="seclab-fade-up flex flex-col gap-4">
            {/* Steps */}
            <ol className="flex flex-col gap-2">
              <VerifyStep ok pass label="Parse state" detail="4 parts: clientId · returnTo · timestamp · signature" />
              <VerifyStep
                ok
                pass={!c.expired}
                label="Check freshness (10-min TTL)"
                detail={`issued ${c.ageMin} min ago${c.expired ? " → expired" : " → ok"}`}
              />
              <VerifyStep
                ok={!c.expired}
                pass={!c.expired && c.sig === c.expected}
                label="Recompute HMAC-SHA256 + constant-time compare"
                detail={c.expired ? "skipped (already rejected)" : c.sig === c.expected ? "diff = 0x00 → match" : "diff ≠ 0 → mismatch"}
              >
                {!c.expired && (
                  <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-[var(--surface-3)]/50 bg-[var(--surface-0)] p-2.5">
                    <HexRow label="state.sig" hex={c.sig} other={c.expected} />
                    <HexRow label="recomputed" hex={c.expected} other={c.sig} />
                  </div>
                )}
              </VerifyStep>
            </ol>

            {/* Verdict */}
            <div
              className={
                "flex items-start gap-3 rounded-md border p-4 " +
                (verdict.ok
                  ? "border-[var(--positive)]/40 bg-[var(--positive)]/[0.07]"
                  : "border-[var(--negative)]/40 bg-[var(--negative)]/[0.07]")
              }
            >
              {verdict.ok ? (
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-[var(--positive)]" />
              ) : (
                <span className="seclab-stamp mt-0.5 shrink-0"><Ban size={20} className="text-[var(--negative)]" /></span>
              )}
              <div>
                <div className={"text-[14px] font-semibold " + (verdict.ok ? "text-[var(--positive)]" : "text-[var(--negative)]")}>
                  {verdict.ok ? "verifyState → ok · proceed to token exchange" : `HTTP 400 · OAuth state rejected: ${verdict.reason}`}
                </div>
                <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                  {verdict.detail}
                  {!verdict.ok && " — no token exchange, no credentials written."}
                </div>
              </div>
            </div>

            <button onClick={() => setSubmitted(false)} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-[var(--surface-3)]/70 bg-[var(--surface-2)] px-3.5 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
              <RotateCcw size={14} /> Back
            </button>
          </div>
        )
      )}
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors " +
        (active
          ? "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)]"
          : "border border-[var(--surface-3)]/70 bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]")
      }
    >
      {children}
    </button>
  );
}

function VerifyStep({ ok, pass, label, detail, children }: { ok: boolean; pass: boolean; label: string; detail: string; children?: React.ReactNode }) {
  return (
    <li className="rounded-md border border-[var(--surface-3)]/40 bg-[var(--surface-2)]/30 p-3">
      <div className="flex items-center gap-2.5">
        {!ok ? (
          <span className="h-4 w-4 shrink-0 rounded-full border border-[var(--surface-3)] bg-[var(--surface-1)]" />
        ) : pass ? (
          <CheckCircle2 size={16} className="shrink-0 text-[var(--positive)]" />
        ) : (
          <Ban size={16} className="shrink-0 text-[var(--negative)]" />
        )}
        <span className="text-[13px] font-medium text-[var(--text-primary)]">{label}</span>
        <span className="ml-auto font-mono text-[11px] text-[var(--text-tertiary)]">{detail}</span>
      </div>
      {children}
    </li>
  );
}

/** Renders a 64-char hex signature, highlighting characters that differ from `other`. */
function HexRow({ label, hex, other }: { label: string; hex: string; other: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[72px] shrink-0 font-mono text-[10px] text-[var(--text-tertiary)]">{label}</span>
      <div className="overflow-x-auto whitespace-nowrap font-mono text-[10.5px] leading-none tracking-tight">
        {hex.split("").map((ch, i) => (
          <span key={i} className={ch !== other[i] ? "rounded-[2px] bg-[var(--negative)]/25 text-[var(--negative)]" : "text-[var(--text-secondary)]"}>
            {ch}
          </span>
        ))}
      </div>
    </div>
  );
}
