"use client";

/**
 * Demo 1 — Row-Level Security tenant isolation.
 *
 * Faithful to the real app: every data table carries the SELECT policy
 *   is_super_admin() OR (client_id IN (SELECT accessible_client_ids()))
 * where accessible_client_ids() is derived from the signed-in user's allowlist
 * row. A cross-tenant read isn't an error — Postgres silently filters it to
 * 0 rows (HTTP 200), so an attacker can't even confirm the other tenant exists.
 *
 * The user picks which client's rows to SELECT as alice@brightside-dental.com
 * and watches the policy evaluate the set membership, then allow or filter.
 */
import { useEffect, useRef, useState } from "react";
import { Database, KeyRound, Play, RotateCcw, CheckCircle2, Ban, ArrowRight } from "lucide-react";

const SELF = { name: "Brightside Dental", uuid: "b2b2b2b2-…-brightside" };
const OTHER = { name: "Apex Law Group", uuid: "a1a1a1a1-…-apexlaw" };

export function TenantIsolationDemo() {
  const [target, setTarget] = useState<"self" | "other">("other");
  const [step, setStep] = useState(0); // 0 idle · 1 request · 2 policy · 3 result
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const allowed = target === "self";
  const t = allowed ? SELF : OTHER;

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  function run() {
    clearTimers();
    setStep(0);
    timers.current.push(setTimeout(() => setStep(1), 60));
    timers.current.push(setTimeout(() => setStep(2), 720));
    timers.current.push(setTimeout(() => setStep(3), 1500));
  }
  function reset() { clearTimers(); setStep(0); }

  return (
    <div className="flex flex-col gap-5">
      {/* Who you are + what you're querying */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2 text-[12.5px]">
          <KeyRound size={14} className="text-[var(--accent-fg)]" />
          <span className="text-[var(--text-tertiary)]">Signed in as</span>
          <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[var(--text-primary)]">alice@brightside-dental.com</code>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] text-[var(--text-tertiary)]">Read rows for:</span>
          <Seg active={target === "self"} onClick={() => { setTarget("self"); reset(); }}>Brightside (yours)</Seg>
          <Seg active={target === "other"} onClick={() => { setTarget("other"); reset(); }}>Apex Law (not yours)</Seg>
        </div>
      </div>

      {/* The query */}
      <pre className="overflow-x-auto rounded-md border border-[var(--surface-3)]/50 bg-[var(--surface-0)] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
        <span className="text-[var(--accent-fg)]">select</span> * <span className="text-[var(--accent-fg)]">from</span> ghl_opportunities{"\n"}
        <span className="text-[var(--accent-fg)]">where</span> client_id = <span className="text-[var(--text-primary)]">&apos;{t.uuid}&apos;</span>;
      </pre>

      {/* Pipeline: request → Postgres RLS → result */}
      <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
        <Stage on={step >= 1} label="Request" sub="Supabase anon key">
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <KeyRound size={14} /> Authenticated as Brightside
          </div>
        </Stage>

        <Conn on={step >= 2} />

        <Stage on={step >= 2} label="Postgres · RLS policy" accent>
          <div className="flex flex-col gap-1.5 font-mono text-[11px] leading-relaxed">
            <div className="text-[var(--text-tertiary)]">accessible_client_ids() →</div>
            <div className="text-[var(--text-primary)]">{"{ b2b2…-brightside }"}</div>
            <div className="mt-1 text-[var(--text-tertiary)]">{t.uuid.split("-")[0]}… ∈ set ?</div>
            {step >= 3 && (
              <div className={"seclab-pop font-semibold " + (allowed ? "text-[var(--positive)]" : "text-[var(--negative)]")}>
                {allowed ? "= true → pass" : "= false → filter"}
              </div>
            )}
          </div>
        </Stage>

        <Conn on={step >= 3} ok={allowed} />

        <Stage on={step >= 3} label="Result">
          {step >= 3 ? (
            allowed ? (
              <div className="seclab-pop flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--positive)]"><CheckCircle2 size={15} /> 642 rows</div>
                <div className="text-[11px] text-[var(--text-tertiary)]">HTTP 200 · your data</div>
              </div>
            ) : (
              <div className="seclab-pop flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--negative)]"><Ban size={15} /> 0 rows</div>
                <div className="text-[11px] text-[var(--text-tertiary)]">HTTP 200 · RLS filtered</div>
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
            <span className={"seclab-fade-up inline-flex items-center gap-2 " + (allowed ? "text-[var(--positive)]" : "text-[var(--negative)]")}>
              {allowed ? <CheckCircle2 size={15} /> : <Ban size={15} />}
              {allowed
                ? "Allowed — the requested client is in your accessible set."
                : "Blocked silently — no error, no rows, no hint the tenant even exists."}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step >= 3 ? (
            <button onClick={reset} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--surface-3)]/70 bg-[var(--surface-2)] px-3.5 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
              <RotateCcw size={14} /> Reset
            </button>
          ) : (
            <button onClick={run} className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--ps-yellow)] px-4 text-[13px] font-semibold text-[var(--text-on-yellow)] transition-[filter] hover:brightness-95">
              <Play size={14} /> Run query
            </button>
          )}
        </div>
      </div>
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

function Stage({ on, label, sub, accent, children }: { on: boolean; label: string; sub?: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={
        "flex flex-col gap-2 rounded-md border p-3.5 transition-all duration-300 " +
        (on
          ? accent
            ? "border-[var(--ps-yellow)]/45 bg-[var(--ps-yellow)]/[0.06]"
            : "border-[var(--surface-3)]/70 bg-[var(--surface-2)]/50"
          : "border-[var(--surface-3)]/30 bg-[var(--surface-1)] opacity-70")
      }
    >
      <div className="flex items-center gap-1.5">
        {accent && <Database size={13} className="text-[var(--accent-fg)]" />}
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">{label}</span>
      </div>
      {children}
      {sub && <div className="text-[10.5px] text-[var(--text-tertiary)]">{sub}</div>}
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
