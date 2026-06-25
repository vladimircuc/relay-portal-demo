import { ShieldCheck, ArrowRight, Database, KeyRound, Globe } from "lucide-react";
import { ProgressLink } from "@/components/progress-link";

/**
 * Prominent entry point to the public Security Lab (/security), shown at the top
 * of the staff /clients page. The Lab is the portfolio centerpiece — three
 * interactive attack/defense demos — so this banner is loud on purpose.
 */
export function SecurityLabBanner() {
  return (
    <ProgressLink
      href="/security"
      className="group relative block overflow-hidden rounded-[var(--radius-card)] border border-[var(--ps-yellow)]/35 bg-[var(--surface-1)] p-6 sm:p-7 transition-colors hover:border-[var(--ps-yellow)]/70"
    >
      {/* Brand glow — intensifies on hover. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-60 w-60 rounded-full opacity-55 blur-3xl transition-opacity group-hover:opacity-90"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--ps-yellow) 30%, transparent), transparent 70%)",
        }}
      />
      <div className="relative flex items-center gap-5 flex-wrap">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-yellow)]/12 text-[var(--accent-fg)]">
          <ShieldCheck size={24} />
        </div>
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">Security Lab</h2>
            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md bg-[var(--ps-yellow)]/15 text-[var(--accent-fg)] border border-[var(--ps-yellow)]/30">
              Interactive
            </span>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)] mt-1 max-w-xl leading-relaxed">
            Three hands-on demos of how Relay defends itself — try to break tenant
            isolation, forge an OAuth callback, and trip the SSRF guard, then watch
            each attack get stopped.
          </p>
          <div className="flex items-center gap-3.5 mt-2.5 text-[11px] text-[var(--text-tertiary)] flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <Database size={12} /> RLS tenancy
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound size={12} /> OAuth HMAC
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Globe size={12} /> SSRF guard
            </span>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 h-11 px-5 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] text-[14px] font-semibold shrink-0 transition-[filter] group-hover:brightness-95">
          Open Security Lab
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </ProgressLink>
  );
}
