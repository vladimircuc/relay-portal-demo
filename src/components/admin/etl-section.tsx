/**
 * Per-client ETL Status section — compact two-card layout.
 *
 * Left card  = Meta Ads  (latest meta_daily OR meta_backfill, whichever
 *              is more recent) + "Run Meta backfill" button. The backfill
 *              pulls the maximum range Meta supports in one shot (~36mo)
 *              and overwrites overlapping days via PK upsert.
 *
 * Right card = Asera     (latest ghl_full) + "Run Asera sweep" button.
 *              Paginate every opportunity, upsert.
 *
 * Card structure (visual top-to-bottom):
 *   [logo + name]               [status pill]
 *   relative time line  ·  rows · duration
 *   (optional) inline error block
 *   button                     "takes ~Xs" hint
 *
 * The button shows real-time loading state once clicked — the icon swaps
 * to a spinner, the label becomes "Backfilling…" / "Sweeping…", the bg
 * darkens to a "wait" tone, and the global top progress bar pulses.
 * That's three independent visual signals; hard to miss.
 */
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/server";
import { RunEtlButton } from "./run-etl-button";

type Props = {
  clientId: string;
  clientSlug: string;
};

// Date helpers for the Meta backfill button's request body. Meta accepts
// ~37 months max; we request 36 to stay safely inside that.
function yesterdayYmd(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function monthsAgoYmd(months: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

type EtlRun = {
  id: string;
  source: string;
  status: "success" | "failure" | "partial";
  rows_written: number | null;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
};

export async function EtlSection({ clientId, clientSlug }: Props) {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("etl_runs")
    .select("id, source, status, rows_written, started_at, finished_at, error_message")
    .eq("client_id", clientId)
    .order("started_at", { ascending: false })
    .limit(40);

  const runs = (data as EtlRun[] | null) ?? [];
  const latestMeta =
    runs.find((r) => r.source === "meta_daily" || r.source === "meta_backfill") ?? null;
  const latestAsera = runs.find((r) => r.source === "ghl_full") ?? null;

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">ETL Status</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          The daily cron runs every morning at 5 AM Central. Use these buttons to manually pull
          fresh data — the Meta backfill pulls the maximum range (~36 months) and overwrites
          overlapping days; the Asera sweep paginates every opportunity and upserts.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <CompactSourceCard
          logoSrc="/brand/meta-icon.png"
          logoAlt="Meta"
          name="Meta Ads"
          run={latestMeta}
          hint="Takes ~15–60s depending on range."
        >
          <RunEtlButton
            clientId={clientId}
            source="meta"
            body={{ since: monthsAgoYmd(36), until: yesterdayYmd() }}
            pendingLabel="Backfilling Meta…"
            overlayTitle="Backfilling Meta Ads"
            overlaySubtitle="Pulling the maximum range (~36 months) — this can take up to a minute."
            overlayIconSrc="/brand/meta-icon.png"
          >
            Run Meta backfill
          </RunEtlButton>
        </CompactSourceCard>

        <CompactSourceCard
          logoSrc="/brand/asera-icon.png"
          logoAlt="Asera"
          name="Asera"
          run={latestAsera}
          hint="Takes ~10–60s depending on opportunity count."
        >
          <RunEtlButton
            clientId={clientId}
            source="ghl"
            pendingLabel="Sweeping Asera…"
            overlayTitle="Sweeping Asera"
            overlaySubtitle="Paginating every opportunity and upserting — this can take up to a minute."
            overlayIconSrc="/brand/asera-icon.png"
          >
            Run Asera sweep
          </RunEtlButton>
        </CompactSourceCard>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One compact source card

function CompactSourceCard({
  logoSrc,
  logoAlt,
  name,
  run,
  hint,
  children,
}: {
  logoSrc: string;
  logoAlt: string;
  name: string;
  run: EtlRun | null;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-5 flex flex-col gap-4">
      {/* Header row: logo + name on the left, status pill on the right */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt={logoAlt}
            className="h-6 w-6 object-contain shrink-0"
            aria-hidden
          />
          <span className="text-base font-semibold text-[var(--text-primary)] truncate">
            {name}
          </span>
        </div>
        <StatusBadge run={run} />
      </div>

      {/* Stats line (only when last run succeeded) */}
      {run?.status === "success" && (
        <div className="text-[12px] text-[var(--text-tertiary)] tabular-nums -mt-1">
          {formatRows(run.rows_written)} · {durationMs(run.started_at, run.finished_at)}
        </div>
      )}

      {/* Inline error block when last run failed */}
      {run?.status === "failure" && run.error_message && (
        <div className="bg-[var(--negative)]/8 border border-[var(--negative)]/30 rounded-md p-2.5 text-[11px] flex gap-2 items-start">
          <AlertTriangle size={12} className="text-[var(--negative)] shrink-0 mt-0.5" />
          <pre className="text-[var(--text-primary)] whitespace-pre-wrap break-words flex-1 font-mono leading-relaxed">
            {run.error_message}
          </pre>
        </div>
      )}

      {/* Button + hint pinned at the bottom of the card */}
      <div className="mt-auto flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-[var(--text-tertiary)]">{hint}</span>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ run }: { run: EtlRun | null }) {
  if (!run) {
    return (
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border border-[var(--surface-3)]/60 bg-[var(--surface-3)]/30 rounded-md px-2 py-0.5 shrink-0">
        Never run
      </span>
    );
  }
  const success = run.status === "success";
  const Icon = success ? CheckCircle2 : AlertTriangle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border whitespace-nowrap shrink-0",
        success
          ? "text-[var(--positive)] border-[var(--positive)]/30 bg-[var(--positive)]/10"
          : "text-[var(--negative)] border-[var(--negative)]/30 bg-[var(--negative)]/10",
      )}
    >
      <Icon size={11} />
      {success ? "Success" : "Failed"}
      <span className="text-[var(--text-tertiary)] mx-0.5">·</span>
      <span className="text-[var(--text-secondary)] tabular-nums">{formatRelative(run.started_at)}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function formatRows(rows: number | null): string {
  const n = rows ?? 0;
  return `${n.toLocaleString("en-US")} row${n === 1 ? "" : "s"}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric" });
}

function durationMs(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "?";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
