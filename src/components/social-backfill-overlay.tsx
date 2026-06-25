"use client";

/**
 * On-connect "pulling your history…" blocker.
 *
 * When a social platform is connected, the OAuth callback (or Meta page-picker
 * action) kicks a minutes-long historical backfill in the BACKGROUND and
 * redirects back with a `?<platform>_connected=1` flag. The heavy work is
 * invisible server-side, so without this the page would just look "done" while
 * data trickles in later. This overlay closes that gap: it blocks the page,
 * shows per-platform progress sourced from social_backfill_jobs (polled via
 * /api/social/backfill/status), and — when every job finishes — flashes a
 * success state, refreshes the server data so the freshly-imported numbers
 * appear, and dismisses itself.
 *
 * Mounted on the two OAuth return targets (/[slug]/socials and /[slug]/admin).
 * Renders nothing unless a backfill is in flight, so it's inert on normal loads.
 *
 * Resilience:
 *   - Auto-resumes if the page is refreshed mid-backfill (re-checks status on
 *     mount even without the URL flag).
 *   - Grace timeout: if a connect flag is present but no job ever materialises
 *     (e.g. no CRON_SECRET locally so the kick never fired), it dismisses
 *     quietly instead of trapping the user.
 *   - "Hide" escape hatch (the backfill keeps running server-side regardless),
 *     remembered for the session so it doesn't nag on the next refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import { CLOSE_SOCIALS_CONNECT_EVENT } from "@/components/socials-connect-button";

export type Job = {
  platform: string;
  status: "pending" | "running" | "done" | "error";
  rowsWritten: number;
  error: string | null;
};

const PLATFORM_LABEL: Record<string, string> = {
  meta_facebook: "Facebook",
  meta_instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};
// Stable display order regardless of how the jobs come back.
const PLATFORM_ORDER = ["meta_facebook", "meta_instagram", "youtube", "tiktok", "linkedin"];

// URL flags the connect callbacks append on success → "a backfill was kicked".
const CONNECT_FLAGS = ["meta_connected", "tiktok_connected", "youtube_connected", "linkedin_connected"];

const POLL_MS = 2500;
const GRACE_MS = 25_000; // no job ever appears → assume the kick didn't fire, dismiss
const DONE_FLASH_MS = 1900; // how long to show success before auto-dismissing

export function SocialBackfillOverlay({ clientId }: { clientId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<"off" | "running" | "done">("off");
  const [jobs, setJobs] = useState<Job[]>([]);

  // Mutable flags the polling loop reads without re-subscribing.
  const startRef = useRef(0);
  const sawJobRef = useRef(false);
  const finishedRef = useRef(false);
  const hiddenKey = `ps_bf_hidden_${clientId}`;

  // Strip the *_connected flag(s) so a manual refresh doesn't re-trigger the
  // overlay. Preserves the path, any other query params, and the #hash.
  const clearConnectFlags = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let changed = false;
    for (const f of CONNECT_FLAGS) {
      if (url.searchParams.has(f)) {
        url.searchParams.delete(f);
        changed = true;
      }
    }
    if (changed) window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  const finish = useCallback(
    (refresh: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      clearConnectFlags();
      try {
        sessionStorage.removeItem(hiddenKey);
      } catch {
        /* sessionStorage may be unavailable */
      }
      setPhase("off");
      if (refresh) router.refresh();
    },
    [clearConnectFlags, hiddenKey, router],
  );

  // Recomputed every render; flips true when a connect redirect lands —
  // INCLUDING the Meta page-picker's server action, which soft-redirects to
  // ?meta_connected=1 WITHOUT remounting us. A one-time window.location read on
  // mount would never see that (the original mount was on ?meta_picker=1), so
  // we source it from useSearchParams, which re-renders us when the URL changes.
  const connectTriggered = CONNECT_FLAGS.some((f) => searchParams.get(f) === "1");

  // ── Activation: show the overlay when a connect flag appears (fresh mount OR
  //    soft-nav), else resume a still-running backfill on mount. All setState
  //    runs inside the async IIFE (never synchronously in the effect body) to
  //    avoid a cascading mount render. ──
  useEffect(() => {
    if (!clientId || typeof window === "undefined") return;
    // Once a cycle has wrapped up (success / grace dismiss / hide) on this
    // mount, don't re-arm from a later flag flip — finish() does a
    // replaceState that re-runs this effect with the flag cleared.
    if (finishedRef.current) return;
    let cancelled = false;

    (async () => {
      // A fresh connect — always show, even if a previous one was hidden.
      if (connectTriggered) {
        try {
          sessionStorage.removeItem(hiddenKey);
        } catch {
          /* ignore */
        }
        if (cancelled) return;
        // The connect modal stays open across the picker's soft-nav redirect;
        // get it out from under the blocker (no-op if it isn't mounted/open).
        window.dispatchEvent(new Event(CLOSE_SOCIALS_CONNECT_EVENT));
        startRef.current = Date.now();
        setPhase("running");
        return;
      }

      // No connect flag: resume a still-running backfill across a refresh,
      // unless the user explicitly hid it earlier this session.
      try {
        if (sessionStorage.getItem(hiddenKey) === "1") return;
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch(`/api/social/backfill/status?clientId=${clientId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled || !data.active) return;
        startRef.current = Date.now();
        sawJobRef.current = true;
        if (Array.isArray(data.jobs)) setJobs(data.jobs);
        setPhase("running");
      } catch {
        /* nothing to resume */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clientId, hiddenKey, connectTriggered]);

  // ── Polling loop while running. ──
  useEffect(() => {
    if (phase !== "running") return;
    let stopped = false;

    const poll = async () => {
      if (finishedRef.current || stopped) return;
      try {
        const res = await fetch(`/api/social/backfill/status?clientId=${clientId}`, { cache: "no-store" });
        if (stopped || finishedRef.current) return;
        if (!res.ok) {
          finish(false); // 403 / 500 — don't trap the user behind an error
          return;
        }
        const data = await res.json();
        if (stopped || finishedRef.current) return;
        const js: Job[] = Array.isArray(data.jobs) ? data.jobs : [];
        setJobs(js);
        if (js.length) sawJobRef.current = true;

        if (!data.active) {
          if (sawJobRef.current) {
            setPhase("done"); // all jobs finished → flash success, then dismiss
          } else if (Date.now() - startRef.current > GRACE_MS) {
            finish(false); // job never materialised (no kick) → give up quietly
          }
          // else: job row not created yet — keep polling within the grace window
        }
      } catch {
        // Network blip — keep polling; the grace timeout catches a dead kick.
      }
    };

    poll(); // immediate first check
    const id = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [phase, clientId, finish]);

  // ── Success flash → auto-dismiss + refresh so the new numbers appear. ──
  useEffect(() => {
    if (phase !== "done") return;
    const id = setTimeout(() => finish(true), DONE_FLASH_MS);
    return () => clearTimeout(id);
  }, [phase, finish]);

  // ── Body scroll lock while the blocker is up. ──
  useEffect(() => {
    if (phase === "off") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [phase]);

  if (phase === "off" || typeof document === "undefined") return null;

  const handleHide = () => {
    try {
      sessionStorage.setItem(hiddenKey, "1");
    } catch {
      /* ignore */
    }
    finishedRef.current = true; // stop loops without forcing a refresh
    clearConnectFlags();
    setPhase("off");
  };

  const done = phase === "done";

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      aria-label={done ? "Historical import complete" : "Importing your historical data"}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--surface-0)]/75 backdrop-blur-sm p-4"
    >
      <BackfillOverlayCard done={done} jobs={jobs} onHide={handleHide} />
    </div>,
    document.body,
  );
}

/**
 * Presentational card — the look of the overlay, split out so the preview
 * harness can render each state directly. The stateful overlay above wraps
 * this in the blocking portal.
 */
export function BackfillOverlayCard({
  done,
  jobs,
  onHide,
}: {
  done: boolean;
  jobs: Job[];
  onHide?: () => void;
}) {
  const ordered = [...jobs].sort(
    (a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform),
  );
  return (
    <div className="w-full max-w-[400px] flex flex-col gap-4 px-7 py-6 rounded-[var(--radius-card)] bg-[var(--surface-1)] border border-[var(--surface-3)]/60 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9 shrink-0 flex items-center justify-center">
          {done ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--positive)]/15">
              <Check size={20} className="text-[var(--positive)]" aria-hidden />
            </span>
          ) : (
            <Loader2 size={34} className="animate-spin text-[var(--accent-fg)]" aria-hidden />
          )}
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {done ? "All caught up!" : "Importing your history…"}
          </div>
          <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
            {done
              ? "Your historical data is ready."
              : "Pulling each platform's past data — this can take a few minutes."}
          </div>
        </div>
      </div>

      {/* Per-platform progress */}
      <div className="flex flex-col gap-1.5 rounded-[var(--radius-input,10px)] bg-[var(--surface-2)]/50 p-3">
        {ordered.length === 0 ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]">
            <Loader2 size={13} className="animate-spin text-[var(--accent-fg)]" aria-hidden />
            Preparing…
          </div>
        ) : (
          ordered.map((j) => (
            <div key={j.platform} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <StatusIcon status={j.status} />
                <span className="text-[13px] text-[var(--text-secondary)] truncate">
                  {PLATFORM_LABEL[j.platform] ?? j.platform}
                </span>
              </div>
              <span className="text-[11px] text-[var(--text-tertiary)] whitespace-nowrap">
                {statusLabel(j)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Footer — only while running; the success state auto-dismisses. */}
      {!done && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            Safe to leave — the import keeps running.
          </span>
          <button
            type="button"
            onClick={onHide}
            className="text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            Hide
          </button>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: Job["status"] }) {
  if (status === "done") return <Check size={14} className="text-[var(--positive)] shrink-0" aria-hidden />;
  if (status === "error") return <AlertTriangle size={14} className="text-[var(--warning)] shrink-0" aria-hidden />;
  return <Loader2 size={14} className="animate-spin text-[var(--accent-fg)] shrink-0" aria-hidden />;
}

function statusLabel(j: Job): string {
  switch (j.status) {
    case "done":
      return j.rowsWritten > 0 ? `${j.rowsWritten} ${j.rowsWritten === 1 ? "day" : "days"}` : "Up to date";
    case "error":
      return "Couldn't import";
    default:
      return "Importing…";
  }
}
