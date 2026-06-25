"use client";

/**
 * Login page (demo). The real product is passwordless — Google OAuth + email
 * magic link via Supabase Auth. In this synthetic demo there are no real
 * accounts, so every sign-in button just drops the visitor into a super-admin
 * session over mock data. The "How sign-in works" popover explains the real,
 * production implementation + its security.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Mail, KeyRound } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/safe-next";
import { Logo } from "@/components/logo";
import { FixedThemeToggle } from "@/components/ui/theme-toggle";
import { HowItWorksTip } from "@/components/how-it-works";

// Public demo credentials — this whole project is a synthetic portfolio demo.
const DEMO_EMAIL = "demo@relay.app";
const DEMO_PASSWORD = "relay-demo-2026";

function LoginInner() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const router = useRouter();
  const next = safeNextPath(params.get("next"));

  async function enterDemo() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
      setLoading(false);
    }
  }

  const showNoAccessBanner = params.get("error") === "no_access";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[var(--surface-0)]">
      <FixedThemeToggle />
      <div className="w-full max-w-md flex flex-col gap-8">
        <Logo size={36} href={null} />

        <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-10 flex flex-col gap-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                Client Dashboard
              </h1>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Sign in with your company email to access your performance dashboard.
              </p>
            </div>
            <HowItWorksTip
              label="How sign-in works"
              title="Authentication, in production"
              Icon={KeyRound}
              intro="The real product is passwordless, so there's nothing to type here — any button signs you in as a super-admin over synthetic data."
              steps={[
                { title: "Passwordless sign-in", body: "Google OAuth or an email magic link via Supabase Auth. No password store exists, so there is nothing to leak or brute-force." },
                { title: "Access control", body: "Users are matched to a client by company-domain rules and a per-email allowlist; the super-admin domain sees every client." },
                { title: "Server-validated sessions", body: "Every request re-derives identity from the session on the server, never from anything the browser sends." },
              ]}
              security={{ body: "Sessions live in httpOnly, SameSite cookies (no token in JS). The edge middleware refreshes the session and gates every protected route before a page renders." }}
              footnote="Demo — no real authentication runs here."
            />
          </div>

          {showNoAccessBanner && (
            <div className="text-xs px-3 py-2 rounded-md bg-[color-mix(in_oklab,var(--negative)_15%,transparent)] text-[color-mix(in_oklab,var(--negative)_85%,white)] border border-[color-mix(in_oklab,var(--negative)_35%,transparent)]">
              Your email isn&apos;t authorized to access any client dashboards. Contact your Relay rep.
            </div>
          )}

          {/* Google OAuth (demo: drops you in). */}
          <button
            type="button"
            onClick={enterDemo}
            disabled={loading}
            className="inline-flex items-center justify-center gap-3 h-11 rounded-lg bg-[var(--surface-2)] text-[var(--text-primary)] border border-[var(--surface-3)] font-medium hover:bg-[var(--surface-3)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <GoogleIcon />
            {loading ? "Signing in…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--surface-3)]/60" />
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">or</div>
            <div className="h-px flex-1 bg-[var(--surface-3)]/60" />
          </div>

          <div className="flex flex-col gap-3">
            <label htmlFor="login-email" className="text-[11px] uppercase tracking-wider text-[var(--text-secondary)]">
              Email address
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  enterDemo();
                }
              }}
              placeholder="you@yourcompany.com"
              className="h-11 px-4 rounded-lg bg-[var(--surface-0)] border border-[var(--surface-3)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--ps-yellow)] focus:outline-none transition-colors"
            />
            <button
              type="button"
              onClick={enterDemo}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 h-11 rounded-lg bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] font-semibold hover:bg-[var(--ps-yellow-soft)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Mail size={16} />
              {loading ? "Signing in…" : "Send sign-in link"}
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
            <span className="rounded border border-[var(--accent-fg)]/40 bg-[color-mix(in_oklab,var(--accent-fg)_12%,transparent)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-[var(--accent-fg)]">
              demo
            </span>
            Any sign-in drops you in as a super-admin over synthetic data.
          </div>

          {error && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-md bg-[color-mix(in_oklab,var(--negative)_15%,transparent)] border border-[color-mix(in_oklab,var(--negative)_40%,transparent)] text-[13px] text-[color-mix(in_oklab,var(--negative)_90%,white)]">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span className="leading-snug break-words">{error}</span>
            </div>
          )}
        </div>

        <p className="text-[11px] text-[var(--text-tertiary)] text-center">
          Relay · Lead-gen performance reporting
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335" />
    </svg>
  );
}
