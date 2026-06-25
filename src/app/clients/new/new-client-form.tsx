"use client";

/**
 * Client-side wrapper for the create-client form.
 *
 * Two things this gives us that a plain server-action <form> can't:
 *   1. `useActionState` to surface validation errors inline without
 *      navigating away or losing the typed values.
 *   2. Slug auto-suggestion: as the user types a name, the slug field
 *      live-fills with the normalised kebab-case form — unless they've
 *      already typed in it themselves, in which case we don't clobber
 *      their override.
 *
 * Form submission still goes through the server action, so this works
 * exactly the same with JS disabled (you just lose the live slug
 * preview and inline errors).
 */
import { useActionState, useState, useEffect, useRef } from "react";
import { createClient, type CreateClientResult } from "./actions";
import { LogoUpload } from "./logo-upload";
import { LocalAdminsField, type LocalAdminDraft } from "./local-admins-field";
import { SubmitPrimary } from "@/components/admin/submit-button";
import type { Capability } from "@/lib/auth";

/** Mirrors normalizeSlug() in actions.ts — keep them in sync. */
function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Decode the JSON the LocalAdminsField posts (and that createClient echoes
 * back on a validation failure) into draft rows. Defensive: anything that
 * isn't a well-formed array of {email, role, scopes} entries yields [].
 */
function parseInitialLocalAdmins(raw: string | undefined): LocalAdminDraft[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): LocalAdminDraft[] => {
      if (!item || typeof item !== "object") return [];
      const obj = item as Record<string, unknown>;
      const email = typeof obj.email === "string" ? obj.email : "";
      const role: LocalAdminDraft["role"] =
        obj.role === "local_super_admin" ? "local_super_admin" : "viewer";
      const scopesRaw: unknown[] = Array.isArray(obj.scopes) ? obj.scopes : [];
      // Forward-map legacy "seo" scope → unified "web" (Web & SEO) capability.
      const scopeSet = new Set(scopesRaw.map((s) => (s === "seo" ? "web" : s)));
      const scopes: Capability[] = (["ads", "socials", "web"] as const).filter((c) =>
        scopeSet.has(c),
      );
      return [{ email, role, scopes }];
    });
  } catch {
    return [];
  }
}

/**
 * Common US timezones with friendly labels. Most agency clients sit in
 * one of these; the "Other…" path lets the user type any IANA zone (the
 * server validates it). Ordered east-to-west so a US-centric audience
 * scans top-down naturally.
 */
const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "America/New_York",    label: "Eastern (New York)" },
  { value: "America/Chicago",     label: "Central (Chicago)" },
  { value: "America/Denver",      label: "Mountain (Denver)" },
  { value: "America/Phoenix",     label: "Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage",   label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (Honolulu)" },
];

export function NewClientForm() {
  const [state, formAction] = useActionState<CreateClientResult | null, FormData>(
    createClient,
    null,
  );

  // Local state for the name/slug pair so we can auto-suggest the slug.
  // Initial values come from the action's `values` on retry (so a failed
  // submit keeps the user's input visible), otherwise blank.
  // We store only the user's EXPLICIT slug override (if any) and DERIVE the
  // effective slug during render — `null` means "user hasn't typed a slug,
  // keep mirroring the name". Deriving in render (instead of syncing via an
  // effect) avoids the cascading-render lint rule and is the React-idiomatic
  // shape for "field B defaults from field A until the user edits B".
  //
  // No "rehydrate after failed submit" effect is needed either: useActionState
  // keeps the SAME component instance across submissions, so this controlled
  // state already survives a re-render. The useState initialisers read
  // state?.values only for the progressive-enhancement (JS-disabled) path,
  // where the server re-renders the form with the echoed values.
  const [name, setName] = useState(state?.values?.name ?? "");
  const [slugOverride, setSlugOverride] = useState<string | null>(
    state?.values?.slug ? state.values.slug : null,
  );
  const slug = slugOverride ?? normalizeSlug(name);

  // Which products this client gets. Defaults to Ads-on (the common case);
  // the server requires ≥1 and we disable submit until one is ticked. These
  // drive the `enabled_services` checkboxes below.
  const seededServices = state?.values?.enabled_services;
  const [ads, setAds] = useState(seededServices ? seededServices.includes("ads") : true);
  const [socials, setSocials] = useState(
    seededServices ? seededServices.includes("socials") : false,
  );
  const [web, setWeb] = useState(seededServices ? seededServices.includes("web") : false);
  const [seo, setSeo] = useState(seededServices ? seededServices.includes("seo") : false);
  // seo ⟹ web: ticking SEO enables Web too; unticking Web clears SEO.
  const toggleWeb = (checked: boolean) => { setWeb(checked); if (!checked) setSeo(false); };
  const toggleSeo = (checked: boolean) => { setSeo(checked); if (checked) setWeb(true); };

  // Seed the local-admins editor from a failed submit's echoed JSON. Only
  // matters on first mount / the JS-disabled re-render — once mounted the
  // editor keeps its own state across submits (useActionState preserves the
  // form instance), so the user's typed rows survive a validation bounce.
  const initialLocalAdmins = parseInitialLocalAdmins(state?.values?.local_admins);

  // Ref-mirror of slug so LogoUpload can read the current value at the moment
  // of upload without re-rendering on every keystroke. Ref mutation only (no
  // setState), so this effect is exempt from the cascading-render rule.
  const slugRef = useRef(slug);
  useEffect(() => {
    slugRef.current = slug;
  }, [slug]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state?.error && (
        <div className="bg-[var(--negative)]/10 border border-[var(--negative)]/40 text-[var(--negative)] rounded-md px-4 py-3 text-sm">
          {state.error}
        </div>
      )}

      <Field
        label="Name"
        hint="The client's display name. Appears in the header and the client picker."
      >
        <input
          name="name"
          type="text"
          autoComplete="off"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Varble Orthodontics"
          className={inputCls}
        />
      </Field>

      <Field
        label="Slug"
        hint={
          slug
            ? `Lives at /${slug}. Auto-derived from the name; edit if needed.`
            : "URL-safe identifier. Auto-derived from the name."
        }
      >
        <input
          name="slug"
          type="text"
          autoComplete="off"
          required
          value={slug}
          onChange={(e) => setSlugOverride(e.target.value)}
          placeholder="varble-orthodontics"
          className={inputCls + " font-mono"}
        />
      </Field>

      <Field
        label="Timezone"
        hint="Used to align daily metrics to the client's calendar day."
      >
        <select
          name="timezone"
          required
          defaultValue={state?.values?.timezone || "America/Chicago"}
          className={inputCls}
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </Field>

      {/*
        Services — which products this client is entitled to. The single
        source of truth (clients.enabled_services) that decides which
        dashboard tabs render and which /admin capability tabs are
        manageable. At least one is required; editable later from admin.
        Plain accent-yellow checkboxes to match the capability-scope picker
        used elsewhere (editable-scopes / add-allowed-email).
      */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
          Services
        </span>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          What we offer this client. Drives which tabs they see (Home is always
          shown). Change it anytime from the client&apos;s admin settings.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-1">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              name="enabled_services"
              value="ads"
              checked={ads}
              onChange={(e) => setAds(e.target.checked)}
              className="accent-[var(--ps-yellow)] h-4 w-4"
            />
            Ads
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              name="enabled_services"
              value="socials"
              checked={socials}
              onChange={(e) => setSocials(e.target.checked)}
              className="accent-[var(--ps-yellow)] h-4 w-4"
            />
            Socials
          </label>
          {/* Web + SEO — the Web & SEO product. SEO is an upsell on top of Web
              (seo ⟹ web): ticking it enables Web and adds the Local heatmap. */}
          <span className="flex items-center gap-x-5 pl-1 border-l border-[var(--surface-3)]/50">
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
              <input
                type="checkbox"
                name="enabled_services"
                value="web"
                checked={web}
                onChange={(e) => toggleWeb(e.target.checked)}
                className="accent-[var(--ps-yellow)] h-4 w-4"
              />
              Web
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
              <input
                type="checkbox"
                name="enabled_services"
                value="seo"
                checked={seo}
                onChange={(e) => toggleSeo(e.target.checked)}
                className="accent-[var(--ps-yellow)] h-4 w-4"
              />
              SEO <span className="text-[11px] text-[var(--text-tertiary)]">(adds heatmap)</span>
            </label>
          </span>
        </div>
        {!ads && !socials && !web && (
          <span className="text-[11px] text-[var(--negative)]">
            Pick at least one service.
          </span>
        )}
      </div>

      <Field
        label="Brand logo"
        hint="Optional. Square works best. Leave blank for the initial-on-color fallback (first letter on the brand accent)."
      >
        <LogoUpload
          getSlug={() => slugRef.current}
          initialUrl={state?.values?.brand_logo_url}
        />
      </Field>

      {/*
        Funnel middle stages — ADS-ONLY. The funnel is an ads-pipeline
        concept (Lead → … → Conversion), so this whole block only shows when
        Ads is enabled; a socials-only client never sees stage-label inputs
        it can't use. When hidden the inputs aren't in the DOM, so the server
        falls back to the "Booking"/"Show" defaults — meaning a later Ads
        enablement still starts from sane labels.

        The first stage (Lead) and last stage (Conversion) are universal
        across clients and hardcoded in the dashboard; only stages 2 + 3
        customise per client (e.g. "Quote Sent" instead of "Booking" for B2B,
        or "Consult Scheduled" for orthodontists). Editable later from
        /<slug>/admin.
      */}
      {ads && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
            Funnel middle stages
          </span>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            The first + last stages are always &ldquo;Lead&rdquo; and
            &ldquo;Conversion&rdquo;. Customise the middle two — e.g. rename
            &ldquo;Booking&rdquo; to &ldquo;Quote Sent&rdquo;. Use singular form
            (&ldquo;Booking&rdquo;, not &ldquo;Bookings&rdquo;). Editable later in admin.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-1 max-w-md">
            <StageLabel
              name="funnel_label_booking"
              label="Stage 2"
              defaultValue={state?.values?.funnel_label_booking ?? "Booking"}
            />
            <StageLabel
              name="funnel_label_show"
              label="Stage 3"
              defaultValue={state?.values?.funnel_label_show ?? "Show"}
            />
          </div>
        </div>
      )}

      {/*
        Initial access — both OPTIONAL and editable later from the client's
        Access section. Domains grant view-only access to everyone on that
        domain (free-form list). Local admins are per-email role + scope
        grants, mirroring Settings → Access.
      */}
      <Field
        label="Allowed email domains"
        hint="Optional. Anyone with an email at these domains can view this client (view-only). Comma- or space-separated."
      >
        <input
          name="allowed_domains"
          type="text"
          autoComplete="off"
          defaultValue={state?.values?.allowed_domains ?? ""}
          placeholder="varbleortho.com, example.com"
          className={inputCls}
        />
      </Field>

      {/*
        Local admins — same model as the client's Settings → Access section:
        each email is granted Viewer (read-only) or Local super-admin (can
        manage the ticked services). Not wrapped in <Field> because it's a
        multi-row interactive control, not a single labelled input. Optional;
        editable later from Access.
      */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
          Local admins
        </span>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Optional. Grant specific people access to this client — Viewer
          (read-only) or Local super-admin (can manage the services you tick).
          Editable later from the client&apos;s Access settings.
        </p>
        <LocalAdminsField initial={initialLocalAdmins} />
      </div>

      <div className="flex justify-end pt-2">
        <SubmitPrimary pendingLabel="Creating…" disabled={!ads && !socials && !web}>
          Create client
        </SubmitPrimary>
      </div>
    </form>
  );
}

/**
 * Compact stage-label input. Smaller-looking than the main fields because
 * four of them sit in a row and would otherwise dominate the form.
 */
function StageLabel({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <input
        name={name}
        type="text"
        autoComplete="off"
        defaultValue={defaultValue}
        maxLength={32}
        className={inputCls}
      />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers

const inputCls =
  "bg-[var(--surface-2)] border border-[var(--surface-3)]/60 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--ps-yellow)] w-full";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-tertiary)]">{hint}</span>}
    </label>
  );
}
