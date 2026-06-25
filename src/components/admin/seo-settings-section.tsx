"use client";

/**
 * Per-client SEO settings tab (/admin → SEO). Three jobs:
 *   1. Config — the 3 property identifiers (GSC site, GA4 property id, Bing
 *      site), each with an info tip on where to find it.
 *   2. Run backfill — triggers /api/etl/seo/[clientId] (full-history pull),
 *      mirroring the Ads "Refresh" button.
 *   3. AI CSV upload — three drag-drop boxes (one per Bing export), merged
 *      (never deleted) into the seo_ai_* tables. Upload is disabled until at
 *      least one file is dropped.
 *
 * A health row shows ✅/⚠️ per source so a missing Kris-grant (or a site not
 * verified in Bing) is obvious at a glance.
 */
import { useRef, useState } from "react";
import { Info, Check, Loader2, XCircle, AlertTriangle, RefreshCw, UploadCloud, Sparkles, MapPin, ChevronDown, Plus, Trash2 } from "lucide-react";
import { updateSeoConfig, addSeoGridReport, removeSeoGridReport, uploadSeoAiCsvs } from "./seo-settings-actions";
import { SubmitPrimary } from "./submit-button";
import type { LsgReportSummary } from "@/lib/etl/brightlocal";
import type { SeoSources } from "@/lib/etl/seo-sources";

type Config = { gsc_site_url: string | null; ga4_property_id: string | null; bing_site_url: string | null; show_leads: boolean };
type Health = { google: boolean; ga4: boolean; bing: boolean; ai: boolean; lastPulled: string | null };
type Backfill =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; breakdown: { key: string; ok: boolean; rows: number; error?: string }[] }
  | { kind: "error"; msg: string };
type Upload = { kind: "idle" } | { kind: "done" } | { kind: "error"; msg: string };

const FIELD =
  "w-full h-9 px-3 rounded-md bg-[var(--surface-2)] border border-[var(--surface-3)]/70 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--ps-yellow)]/60 outline-none";

function HealthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={"inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-md border " +
      (ok
        ? "bg-[var(--positive)]/10 border-[var(--positive)]/40 text-[var(--positive)]"
        : "bg-[var(--ps-yellow)]/10 border-[var(--ps-yellow)]/40 text-[var(--accent-fg)]")}>
      {ok ? <Check size={12} strokeWidth={2.5} /> : <AlertTriangle size={12} />}
      {label}
    </span>
  );
}

/** Small hover "i" that explains where to grab a field. `align` keeps the
 *  popover inside the card (right-most field opens leftward). */
function InfoTip({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Info size={13} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
      {open && (
        <span className={"absolute top-full z-30 w-64 pt-1.5 " + (align === "right" ? "right-0" : "left-0")}>
          <span className="block p-2.5 rounded-md bg-[var(--surface-0)] border border-[var(--surface-3)] shadow-xl text-[11px] text-[var(--text-secondary)] leading-snug normal-case tracking-normal font-normal">
            {text}
          </span>
        </span>
      )}
    </span>
  );
}

/** One drag-drop CSV box (its own labeled dropzone). Sets the underlying
 *  hidden file input so the parent <form> submits it by name. */
function Dropzone({ name, label, onChange }: { name: string; label: string; onChange: (has: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    setFileName(f?.name ?? null);
    onChange(!!f);
  };
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (inputRef.current && e.dataTransfer.files.length) {
          inputRef.current.files = e.dataTransfer.files;
          pick(e.dataTransfer.files);
        }
      }}
      className={"flex flex-col items-center justify-center gap-1.5 h-32 rounded-lg border border-dashed cursor-pointer transition-colors px-3 text-center " +
        (drag
          ? "border-[var(--ps-yellow)] bg-[var(--ps-yellow)]/5"
          : fileName
            ? "border-[var(--positive)]/50 bg-[var(--positive)]/[0.06]"
            : "border-[var(--surface-3)] bg-[var(--surface-2)]/30 hover:border-[var(--surface-3)] hover:bg-[var(--surface-2)]/60")}
    >
      <input ref={inputRef} type="file" name={name} accept=".csv" className="hidden" onChange={(e) => pick(e.target.files)} />
      {fileName ? <Check size={18} className="text-[var(--positive)]" strokeWidth={2.5} /> : <UploadCloud size={18} className="text-[var(--text-tertiary)]" />}
      <span className="text-[12px] font-semibold text-[var(--text-primary)]">{label}</span>
      <span className="text-[11px] text-[var(--text-tertiary)] truncate max-w-full">{fileName ?? "Drop CSV here, or click to choose"}</span>
    </label>
  );
}

/** A connection field that's a pick-from-a-list dropdown when we could fetch the
 *  options (verified GSC sites / GA4 properties / Bing sites), with a manual
 *  text fallback — so a value that isn't auto-detected (or an API hiccup) is
 *  never a dead end. Drives the parent's value via `onChange`; the form submits
 *  via the parent's hidden input. */
function SourceSelect({
  value, onChange, options, placeholder,
}: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder: string;
}) {
  const inList = options.some((o) => o.value === value);
  // Manual mode when there's nothing to pick from, or the saved value isn't a
  // recognised option (e.g. set before this feature, or a site we can't list).
  const [manual, setManual] = useState(options.length === 0 || (!!value && !inList));

  if (manual) {
    return (
      <div className="flex flex-col gap-1">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={FIELD} />
        {options.length > 0 && (
          <button type="button" onClick={() => { setManual(false); onChange(""); }} className="self-start text-[11px] text-[var(--accent-fg)] hover:underline">
            Choose from list instead
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="relative">
      <select
        value={inList ? value : ""}
        onChange={(e) => { const v = e.target.value; if (v === "__manual__") { setManual(true); onChange(""); } else onChange(v); }}
        className={FIELD + " appearance-none pr-9 cursor-pointer"}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value="__manual__">— Enter manually —</option>
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
    </div>
  );
}

export function SeoSettingsSection({
  clientId, clientSlug, config, health, hasSeo, hasAds = false, reports = [], selectedReportIds = [], sources = { ga4: [], gsc: [], bing: [] },
}: {
  clientId: string; clientSlug: string; config: Config; health: Health; hasSeo: boolean; hasAds?: boolean; reports?: LsgReportSummary[]; selectedReportIds?: number[]; sources?: SeoSources;
}) {
  // ── config form ───────────────────────────────────────────────────────────
  const [gsc, setGsc] = useState(config.gsc_site_url ?? "");
  const [ga4, setGa4] = useState(config.ga4_property_id ?? "");
  const [bing, setBing] = useState(config.bing_site_url ?? "");
  // "Show website leads" — available to any Web & SEO client. Ads clients reuse
  // their CRM connection automatically; SEO-only clients connect their own in
  // the "Website leads" card below this section.
  const [showLeads, setShowLeads] = useState(!!config.show_leads);
  const [saved, setSaved] = useState({ gsc: config.gsc_site_url ?? "", ga4: config.ga4_property_id ?? "", bing: config.bing_site_url ?? "", showLeads: !!config.show_leads });
  const configDirty = gsc !== saved.gsc || ga4 !== saved.ga4 || bing !== saved.bing || showLeads !== saved.showLeads;

  // Dropdown options from the live API lists (label distinguishes same-named
  // GA4 properties by account — the trap that caused the wrong-property bug).
  const gscOptions = sources.gsc.map((s) => ({ value: s.siteUrl, label: s.siteUrl }));
  const ga4Options = sources.ga4.map((p) => ({ value: p.id, label: `${p.name} — ${p.account} (${p.id})` }));
  const bingOptions = sources.bing.map((s) => ({ value: s.url, label: s.url }));

  async function handleSaveConfig(formData: FormData) {
    // A source change means cached data is stale → auto-rebuild. A show_leads-only
    // change needs NO backfill (leads are computed live from GHL on each render).
    const changed = gsc !== saved.gsc || ga4 !== saved.ga4 || bing !== saved.bing;
    await updateSeoConfig(formData); // also clears the changed source's stale cache server-side
    setSaved({ gsc, ga4, bing, showLeads });
    if (changed) void runBackfill();
  }

  // ── backfill button ─────────────────────────────────────────────────────────
  const [backfill, setBackfill] = useState<Backfill>({ kind: "idle" });
  async function runBackfill() {
    if (backfill.kind === "running") return;
    setBackfill({ kind: "running" });
    try {
      const res = await fetch(`/api/etl/seo/${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) setBackfill({ kind: "error", msg: data?.error ?? `Pull returned ${res.status}` });
      else setBackfill({ kind: "done", breakdown: data.breakdown ?? [] });
    } catch (e) {
      setBackfill({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── Local search grid (BrightLocal geo-grid — `seo` upsell only) ─────────────
  // A client can link MANY reports (locations). Add one at a time from a dropdown
  // that excludes already-linked reports; each save is its own action.
  const [picked, setPicked] = useState("");
  async function handleAddReport(formData: FormData) {
    await addSeoGridReport(formData);
    setPicked("");
  }
  const byId = new Map(reports.map((r) => [r.reportId, r]));
  const available = reports.filter((r) => !selectedReportIds.includes(r.reportId));
  const [gridPull, setGridPull] = useState<Backfill>({ kind: "idle" });
  async function runGridPull() {
    if (gridPull.kind === "running") return;
    setGridPull({ kind: "running" });
    try {
      const res = await fetch(`/api/etl/seo-grid/${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) setGridPull({ kind: "error", msg: data?.error ?? `Pull returned ${res.status}` });
      else setGridPull({ kind: "done", breakdown: data.breakdown ?? [] });
    } catch (e) {
      setGridPull({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── CSV upload ───────────────────────────────────────────────────────────────
  const [chosen, setChosen] = useState({ overview: false, queries: false, pages: false });
  const anyChosen = chosen.overview || chosen.queries || chosen.pages;
  const [upload, setUpload] = useState<Upload>({ kind: "idle" });
  const [dropKey, setDropKey] = useState(0); // bump to clear the dropzones after a successful upload

  async function handleUpload(formData: FormData) {
    if (!anyChosen) return; // guard: nothing to upload
    setUpload({ kind: "idle" });
    try {
      await uploadSeoAiCsvs(formData);
      setUpload({ kind: "done" });
      setChosen({ overview: false, queries: false, pages: false });
      setDropKey((k) => k + 1);
    } catch (e) {
      setUpload({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">SEO</h2>
          <span className="inline-flex items-center gap-2 flex-wrap">
            <HealthPill label="Search Console" ok={health.google} />
            <HealthPill label="GA4" ok={health.ga4} />
            <HealthPill label="Bing" ok={health.bing} />
            <HealthPill label="AI" ok={health.ai} />
          </span>
        </div>
        <p className="text-[13px] text-[var(--text-secondary)] mt-1 max-w-2xl">
          Connect Search Console, GA4, and Bing for this client, then run a backfill to pull full history.
          {health.lastPulled ? ` Last pulled ${health.lastPulled}.` : " Not pulled yet."}
        </p>
      </div>

      {/* ── Connection config ───────────────────────────────────────────────── */}
      <form action={handleSaveConfig} className="flex flex-col gap-3">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="clientSlug" value={clientSlug} />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
              Search Console site
              <InfoTip text="Pick the client's verified Search Console property from the list (domain properties show as sc-domain:yourdomain.com). Not listed? Choose 'Enter manually' and paste it exactly as shown in GSC's property switcher." />
            </span>
            <input type="hidden" name="gsc_site_url" value={gsc} />
            <SourceSelect value={gsc} onChange={setGsc} options={gscOptions} placeholder="sc-domain:example.com" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
              GA4 property
              <InfoTip text="Pick the client's GA4 property from the list — each shows Name — Account (ID), so two same-named properties in different accounts are easy to tell apart. Not listed? Choose 'Enter manually' and paste the numeric Property ID from GA → Admin → Property settings." />
            </span>
            <input type="hidden" name="ga4_property_id" value={ga4} />
            <SourceSelect value={ga4} onChange={setGa4} options={ga4Options} placeholder="494251634" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
              Bing site URL
              <InfoTip align="right" text="Pick the client's verified Bing site from the list. If it's not there yet, verify it in Bing Webmaster (import from Search Console), or choose 'Enter manually' to paste it." />
            </span>
            <input type="hidden" name="bing_site_url" value={bing} />
            <SourceSelect value={bing} onChange={setBing} options={bingOptions} placeholder="https://example.com/" />
          </label>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)] max-w-3xl">
          Make sure <code className="text-[var(--text-secondary)] mx-0.5">vladimircuc007@gmail.com</code> has access to the client&apos;s Search Console (Full) + GA4 (Viewer), and the site is verified in Bing Webmaster. No per-client Bing key — one agency key covers all sites.
        </p>

        {/* ── Show website leads toggle ─────────────────────────────────────────
            When on, the Website leads tile replaces CTR on the Web & SEO top
            section (Avg position stays). Leads-only — no revenue. Ads clients
            reuse their CRM connection; SEO-only clients connect their own in the
            "Website leads" card below. */}
        <input type="hidden" name="show_leads" value={showLeads ? "1" : "0"} />
        <div className="border-t border-[var(--surface-3)]/40 pt-4 max-w-3xl">
          <button
            type="button"
            onClick={() => setShowLeads((v) => !v)}
            aria-pressed={showLeads}
            className="flex items-start gap-3 text-left w-full group cursor-pointer"
          >
            <span
              className={"mt-0.5 shrink-0 inline-flex items-center justify-center h-[18px] w-[18px] rounded-[5px] border transition-colors " +
                (showLeads
                  ? "bg-[var(--ps-yellow)] border-[var(--ps-yellow)] text-[var(--text-on-yellow)]"
                  : "bg-[var(--surface-2)] border-[var(--surface-3)]/80 text-transparent")}
            >
              <Check size={12} strokeWidth={3} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">Show website leads</span>
              <span className="text-[11px] text-[var(--text-tertiary)] leading-snug">
                Replaces CTR on the Web &amp; SEO top section with a Website leads tile (Avg position stays). Counts CRM opportunities tagged as website / chat-widget leads — not ads.
                {hasAds
                  ? " Uses this client's existing CRM connection."
                  : " This client doesn't run ads, so connect its CRM in the Website leads card below."}
              </span>
            </span>
          </button>
        </div>

        {configDirty && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <SubmitPrimary pendingLabel="Saving…" className="px-3 py-1.5 text-[12px] w-fit">Save connection</SubmitPrimary>
            <span className="text-[11px] text-[var(--text-tertiary)]">Changing a source clears its old data and rebuilds automatically — no manual backfill needed.</span>
          </div>
        )}
      </form>

      {/* ── Backfill ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 border-t border-[var(--surface-3)]/40 pt-5">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={runBackfill}
            disabled={backfill.kind === "running"}
            className={"inline-flex items-center gap-2 h-9 px-3.5 rounded-md text-[12px] font-medium transition-colors " +
              (backfill.kind === "running"
                ? "bg-[var(--surface-2)] border border-[var(--surface-3)]/80 text-[var(--text-secondary)] cursor-wait"
                : "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)] cursor-pointer")}
          >
            {backfill.kind === "running" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {backfill.kind === "running" ? "Pulling…" : "Run backfill"}
          </button>
          <span className="text-[12px] text-[var(--text-secondary)]">Pulls full history (16mo Search Console · GA4 retention · Bing max) into the dashboard.{showLeads ? " (Website leads are refreshed in the same run.)" : ""}</span>
        </div>
        {backfill.kind === "done" && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--positive)]">
            <Check size={14} strokeWidth={2.5} />
            Pull complete — {backfill.breakdown.map((b) => `${b.key}: ${b.ok ? b.rows + " rows" : "failed"}`).join(" · ") || "no sources configured"}
          </div>
        )}
        {backfill.kind === "error" && (
          <div className="flex items-start gap-2 text-[12px] text-[var(--negative)]"><XCircle size={14} className="shrink-0 mt-0.5" />{backfill.msg}</div>
        )}
      </div>

      {/* ── Local search grid (BrightLocal geo-grid) — `seo` UPSELL only ──────
          Visible only when this client has the SEO service. Web-only clients
          don't see it (their dashboard tab also hides the heatmap section). */}
      {hasSeo && (
        <div className="flex flex-col gap-3 border-t border-[var(--surface-3)]/40 pt-5">
          <div className="flex items-center gap-2">
            <MapPin size={15} className="text-[var(--accent-fg)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Local search grid</h3>
          </div>
          <p className="text-[11px] text-[var(--text-tertiary)] max-w-3xl">
            Geo-grid local rankings from BrightLocal, shown as a heatmap on the client&apos;s Web &amp; SEO tab — one map per
            location. Add the client&apos;s Local Search Grid report(s) below; rankings then refresh automatically every day.
          </p>

          {/* Linked reports (one row per location), stacked. */}
          {selectedReportIds.length > 0 && (
            <ul className="flex flex-col gap-1.5 sm:max-w-md">
              {selectedReportIds.map((id) => {
                const r = byId.get(id);
                return (
                  <li key={id} className="flex items-center gap-2.5 pl-3 pr-1.5 h-10 rounded-md bg-[var(--surface-2)]/50 border border-[var(--surface-3)]/50">
                    <MapPin size={13} className="text-[var(--accent-fg)] shrink-0" />
                    <span className="flex-1 text-[13px] text-[var(--text-primary)] truncate">
                      {r ? r.name : `Report ${id}`}
                      {r && <span className="text-[var(--text-tertiary)] font-normal"> · {r.gridSize} · {r.numKeywords} kw</span>}
                    </span>
                    <form action={removeSeoGridReport}>
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="clientSlug" value={clientSlug} />
                      <input type="hidden" name="report_id" value={id} />
                      <button type="submit" aria-label="Remove location" title="Remove location" className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--negative)] hover:bg-[var(--surface-3)]/50 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Add another — the dropdown excludes reports already linked above. */}
          {available.length > 0 ? (
            <form action={handleAddReport} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="clientSlug" value={clientSlug} />
              <label className="flex flex-col gap-1.5 sm:max-w-md w-full">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  {selectedReportIds.length > 0 ? "Add another report" : "Add a report"}
                  <InfoTip text="Pick the client's Local Search Grid report by business name. BrightLocal only ever shows LOCATION ids in its URLs — never the report id — so reports are listed here by name and you never copy an id. Add one, then add the next." />
                </span>
                <div className="relative">
                  <select name="report_id" value={picked} onChange={(e) => setPicked(e.target.value)} className={FIELD + " appearance-none pr-9 cursor-pointer"}>
                    <option value="">— Select a report —</option>
                    {available.map((r) => (
                      <option key={r.reportId} value={String(r.reportId)}>{r.name} · {r.gridSize} · {r.numKeywords} kw</option>
                    ))}
                  </select>
                  <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                </div>
              </label>
              {picked && (
                <SubmitPrimary pendingLabel="Adding…" className="px-3 py-1.5 text-[12px] w-fit">
                  <span className="inline-flex items-center gap-1.5"><Plus size={13} /> Add</span>
                </SubmitPrimary>
              )}
            </form>
          ) : reports.length === 0 ? (
            <p className="text-[11px] text-[var(--text-tertiary)]">No Local Search Grid reports found in BrightLocal yet — create one for this client and it&apos;ll show up here automatically.</p>
          ) : (
            <p className="text-[11px] text-[var(--text-tertiary)]">All your BrightLocal reports are linked to this client.</p>
          )}

          {selectedReportIds.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={runGridPull}
                disabled={gridPull.kind === "running"}
                className={"inline-flex items-center gap-2 h-9 px-3.5 rounded-md text-[12px] font-medium transition-colors " +
                  (gridPull.kind === "running"
                    ? "bg-[var(--surface-2)] border border-[var(--surface-3)]/80 text-[var(--text-secondary)] cursor-wait"
                    : "bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)] cursor-pointer")}
              >
                {gridPull.kind === "running" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {gridPull.kind === "running" ? "Refreshing…" : "Refresh grid data"}
              </button>
              <span className="text-[12px] text-[var(--text-secondary)]">Pulls the latest grid rankings for all linked locations into the dashboard now.</span>
            </div>
          )}
          {gridPull.kind === "done" && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--positive)]">
              <Check size={14} strokeWidth={2.5} />
              Grid updated — {gridPull.breakdown.length ? gridPull.breakdown.map((b) => `${b.key}: ${b.ok ? b.rows + " pts" : "failed"}`).join(" · ") : "no keywords found"}
            </div>
          )}
          {gridPull.kind === "error" && (
            <div className="flex items-start gap-2 text-[12px] text-[var(--negative)]"><XCircle size={14} className="shrink-0 mt-0.5" />{gridPull.msg}</div>
          )}
        </div>
      )}

      {/* ── AI CSV upload ──────────────────────────────────────────────────── */}
      <form action={handleUpload} className="flex flex-col gap-3 border-t border-[var(--surface-3)]/40 pt-5">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="clientSlug" value={clientSlug} />
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-[var(--accent-fg)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">AI Performance — Bing CSV upload</h3>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)] max-w-3xl">
          Bing has no API for Copilot citations, so export the 3 reports from Bing Webmaster → AI Performance and drop each into its box below. Re-uploading <strong>merges</strong> — it never deletes prior data, and you can upload them one at a time.
        </p>
        <div key={dropKey} className="grid gap-3 sm:grid-cols-3">
          <Dropzone name="overview" label="Overview stats" onChange={(has) => setChosen((c) => ({ ...c, overview: has }))} />
          <Dropzone name="queries" label="Search queries" onChange={(has) => setChosen((c) => ({ ...c, queries: has }))} />
          <Dropzone name="pages" label="Page stats" onChange={(has) => setChosen((c) => ({ ...c, pages: has }))} />
        </div>
        <div className="flex items-center gap-3">
          <SubmitPrimary pendingLabel="Uploading…" disabled={!anyChosen} className="px-3 py-1.5 text-[12px] w-fit">
            <span className="inline-flex items-center gap-1.5"><UploadCloud size={13} /> Upload CSVs</span>
          </SubmitPrimary>
          {!anyChosen && <span className="text-[11px] text-[var(--text-tertiary)]">Drop at least one file to upload.</span>}
          {upload.kind === "done" && <span className="text-[12px] text-[var(--positive)] inline-flex items-center gap-1.5"><Check size={13} /> Merged into the dashboard</span>}
          {upload.kind === "error" && <span className="text-[12px] text-[var(--negative)] inline-flex items-center gap-1.5"><XCircle size={13} /> {upload.msg}</span>}
        </div>
      </form>
    </section>
  );
}
