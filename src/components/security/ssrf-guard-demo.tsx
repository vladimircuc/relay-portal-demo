"use client";

/**
 * Demo 3 — SSRF guard on report-logo egress.
 *
 * Faithful to the real inlineImage()/isBlockedHost(): before the PDF renderer
 * fetches a client-supplied logo URL it enforces (1) an http/https protocol
 * whitelist and (2) a host blacklist covering loopback (127/8, ::1, localhost),
 * link-local incl. cloud metadata (169.254/16), and RFC-1918 private ranges
 * (10/8, 172.16/12, 192.168/16, 0/8). A blocked host returns null and the cover
 * falls back to an initial tile — so the headless browser can't reach internal
 * infrastructure. The same classification runs here, live.
 */
import { useEffect, useRef, useState } from "react";
import { ShieldX, CheckCircle2, Ban, Play, RotateCcw, ArrowRight, FileText } from "lucide-react";

type Verdict = { allowed: boolean; ip: string; rule: string; reason: string };

const URLS: { url: string; label: string }[] = [
  { url: "https://cdn.brightside-dental.com/logo.png", label: "Client CDN logo" },
  { url: "http://169.254.169.254/latest/meta-data/", label: "Cloud metadata" },
  { url: "http://localhost:5432/", label: "Local Postgres" },
  { url: "http://10.0.0.5/internal/logo.png", label: "Private network" },
  { url: "file:///etc/passwd", label: "Local file" },
];

/** Mirrors the real guard: protocol whitelist + isBlockedHost() octet checks. */
function classify(raw: string): Verdict {
  let u: URL;
  try { u = new URL(raw); } catch { return { allowed: false, ip: "—", rule: "malformed URL", reason: "Could not parse URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return { allowed: false, ip: "—", rule: "protocol whitelist", reason: `${u.protocol}// is not http/https` };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host === "::1")
    return { allowed: false, ip: host, rule: "loopback / internal host", reason: "blocked hostname" };
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 127) return { allowed: false, ip: host, rule: "127.0.0.0/8 loopback", reason: "loopback range" };
    if (a === 0) return { allowed: false, ip: host, rule: "0.0.0.0/8", reason: "reserved range" };
    if (a === 10) return { allowed: false, ip: host, rule: "10.0.0.0/8 private", reason: "RFC-1918 private" };
    if (a === 169 && b === 254) return { allowed: false, ip: host, rule: "169.254.0.0/16 link-local", reason: "link-local / cloud-metadata" };
    if (a === 192 && b === 168) return { allowed: false, ip: host, rule: "192.168.0.0/16 private", reason: "RFC-1918 private" };
    if (a === 172 && b >= 16 && b <= 31) return { allowed: false, ip: host, rule: "172.16.0.0/12 private", reason: "RFC-1918 private" };
    return { allowed: true, ip: host, rule: "public address", reason: "not in any blocked range" };
  }
  return { allowed: true, ip: "203.0.113.10", rule: "public DNS", reason: "resolves to a public address" };
}

export function SsrfGuardDemo() {
  const [sel, setSel] = useState(1); // default to the cloud-metadata attack
  const [step, setStep] = useState(0); // 0 idle · 1 sent · 2 guard · 3 result
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const v = classify(URLS[sel].url);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  function run() {
    clearTimers();
    setStep(0);
    timers.current.push(setTimeout(() => setStep(1), 60));
    timers.current.push(setTimeout(() => setStep(2), 650));
    timers.current.push(setTimeout(() => setStep(3), 1450));
  }
  function pick(i: number) { clearTimers(); setSel(i); setStep(0); }

  return (
    <div className="flex flex-col gap-5">
      {/* URL picker */}
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] text-[var(--text-tertiary)]">Set the client logo URL to:</span>
        <div className="flex flex-wrap gap-2">
          {URLS.map((u, i) => (
            <button
              key={u.url}
              onClick={() => pick(i)}
              className={
                "rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors " +
                (i === sel
                  ? "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)]"
                  : "border border-[var(--surface-3)]/70 bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]")
              }
            >
              {u.label}
            </button>
          ))}
        </div>
        <code className="mt-1 overflow-x-auto whitespace-nowrap rounded-md border border-[var(--surface-3)]/50 bg-[var(--surface-0)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]">{URLS[sel].url}</code>
      </div>

      {/* Pipeline: URL → SSRF guard → result */}
      <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1.3fr_auto_1fr]">
        <Stage on={step >= 1} label="Report renderer" icon={<FileText size={13} className="text-[var(--text-tertiary)]" />}>
          <div className="text-[12px] text-[var(--text-secondary)]">inlineImage(url)</div>
        </Stage>

        <Conn on={step >= 2} />

        <Stage on={step >= 2} accent label="SSRF guard · isBlockedHost()" icon={<ShieldX size={13} className="text-[var(--accent-fg)]" />}>
          <div className="flex flex-col gap-1 font-mono text-[11px]">
            <Rule on={step >= 2}>protocol ∈ {"{http, https}"}</Rule>
            <Rule on={step >= 3}>resolve → <span className="text-[var(--text-primary)]">{v.ip}</span></Rule>
            {step >= 3 && (
              <div className={"seclab-pop mt-0.5 font-semibold " + (v.allowed ? "text-[var(--positive)]" : "text-[var(--negative)]")}>
                {v.allowed ? "✓ " + v.rule : "✗ " + v.rule}
              </div>
            )}
          </div>
        </Stage>

        <Conn on={step >= 3} ok={v.allowed} />

        <Stage on={step >= 3} label="Result">
          {step >= 3 ? (
            v.allowed ? (
              <div className="seclab-pop flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--positive)]"><CheckCircle2 size={15} /> Inlined</div>
                <div className="text-[11px] text-[var(--text-tertiary)]">data:image/png;base64,…</div>
              </div>
            ) : (
              <div className="seclab-pop flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-md bg-[var(--ps-yellow)]/15 text-[15px] font-bold text-[var(--accent-fg)]">B</span>
                <div className="flex flex-col">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--negative)]"><Ban size={14} /> Refused</span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">falls back to initial tile</span>
                </div>
              </div>
            )
          ) : (
            <div className="text-[12px] text-[var(--text-tertiary)]">—</div>
          )}
        </Stage>
      </div>

      {/* Result strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-h-[20px] text-[12.5px]">
          {step >= 3 && (
            <span className={"seclab-fade-up inline-flex items-center gap-2 " + (v.allowed ? "text-[var(--positive)]" : "text-[var(--negative)]")}>
              {v.allowed ? <CheckCircle2 size={15} /> : <Ban size={15} />}
              {v.allowed
                ? "Allowed — public host, fetched then embedded as base64 (Chromium never resolves the URL itself)."
                : `Blocked — ${v.reason}. The session cookie is never forwarded off-origin either.`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step >= 3 ? (
            <button onClick={() => { clearTimers(); setStep(0); }} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--surface-3)]/70 bg-[var(--surface-2)] px-3.5 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
              <RotateCcw size={14} /> Reset
            </button>
          ) : (
            <button onClick={run} className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--ps-yellow)] px-4 text-[13px] font-semibold text-[var(--text-on-yellow)] transition-[filter] hover:brightness-95">
              <Play size={14} /> Generate report
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stage({ on, label, icon, accent, children }: { on: boolean; label: string; icon?: React.ReactNode; accent?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={
        "flex flex-col gap-2 rounded-md border p-3.5 transition-all duration-300 " +
        (on
          ? accent
            ? "border-[var(--ps-yellow)]/45 bg-[var(--ps-yellow)]/[0.06]"
            : "border-[var(--surface-3)]/70 bg-[var(--surface-2)]/50"
          : "border-[var(--surface-3)]/40 bg-[var(--surface-1)]")
      }
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Rule({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <div className={"flex items-center gap-1.5 transition-colors " + (on ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]")}>
      {on && <CheckCircle2 size={11} className="text-[var(--positive)]" />}
      {children}
    </div>
  );
}

function Conn({ on, ok }: { on: boolean; ok?: boolean }) {
  return (
    <div className="hidden items-center justify-center sm:flex">
      <ArrowRight
        size={18}
        className={
          "transition-colors duration-300 " +
          (!on ? "text-[var(--surface-3)]" : ok === false ? "text-[var(--negative)]" : ok === true ? "text-[var(--positive)]" : "text-[var(--accent-fg)]")
        }
      />
    </div>
  );
}
