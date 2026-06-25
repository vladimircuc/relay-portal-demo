/**
 * Explainer registry for the /admin settings page.
 *
 * Every admin section is wrapped in `data-explain="<key>"`. When a visitor
 * submits one of its forms (or clicks an OAuth connect link), the
 * <DemoActionInterceptor> looks the key up here and opens the matching
 * "how it works in production" modal instead of mutating the demo database.
 *
 * Copy is grounded in how the real product actually works — Supabase Vault for
 * tokens, RLS + the access resolver for tenancy, HMAC-signed OAuth state,
 * constant-time secret checks, capability-scoped RBAC — so the page doubles as a
 * walkthrough of the security model.
 */
import {
  Users,
  LayoutGrid,
  KeyRound,
  GitBranch,
  Database,
  Tags,
  Target,
  DollarSign,
  Link2,
  Power,
  Search,
} from "lucide-react";
import type { ExplainerContent } from "@/components/how-it-works";

export const ADMIN_EXPLAINERS: Record<string, ExplainerContent> = {
  access: {
    title: "Access control, in production",
    Icon: Users,
    intro:
      "This is the allowlist that decides who can open a client's dashboard — and who can manage its settings. Adding, removing, or re-scoping anyone here writes to the access tables.",
    steps: [
      {
        title: "Two grant shapes",
        body: "A whole email domain (anyone @company.com gets read access) or a single email. Individual emails carry a role: viewer, or local super-admin who can also manage a slice of this settings page.",
      },
      {
        title: "Capability scopes",
        body: "A local super-admin is scoped to Ads, Socials, and/or Web & SEO. The /admin page only renders — and only server-fetches — the tabs their scopes allow, so an out-of-scope tab is never even sent to the browser.",
      },
      {
        title: "Server is the source of truth",
        body: "Minting or removing a local super-admin is global-super-admin-only and re-checked in the server action, so a hand-crafted POST can't elevate anyone past what the UI shows.",
      },
    ],
    security: {
      body: "Every dashboard read runs through the same access resolver plus Postgres row-level security keyed to the tenant — the allowlist decides identity, RLS enforces that identity can only ever see its own client's rows.",
    },
    footnote: "Demo — access lists aren't editable here.",
  },

  services: {
    title: "Service entitlements, in production",
    Icon: LayoutGrid,
    intro:
      "Which products this client is paying for — Ads, Socials, Web, and the SEO upsell. This single setting is the source of truth for the whole app.",
    steps: [
      {
        title: "Drives every surface",
        body: "enabled_services decides which dashboard tabs the client sees and which settings tabs an admin can manage. Turn a product off and its tab disappears for everyone.",
      },
      {
        title: "SEO implies Web",
        body: "SEO is an upsell on top of Web: ticking it auto-enables Web and adds the local-rank heatmap; unticking Web clears SEO. The server re-enforces the rule so the stored set is always valid.",
      },
    ],
    security: {
      body: "Only a global super-admin can change entitlements, and every data read re-checks the client's entitlement server-side — flipping a checkbox in devtools can't unlock a product the tenant doesn't own.",
    },
    footnote: "Demo — entitlements aren't editable here.",
  },

  credentials: {
    title: "Provider credentials, in production",
    Icon: KeyRound,
    intro:
      "The Meta Ads and Asera (CRM) tokens that power the daily pulls. How a token is stored matters more than anything else on this page.",
    steps: [
      {
        title: "Token goes straight to the vault",
        body: "On save, the access token is written to Supabase Vault and only the returned secret id is kept in the credentials table. The raw token never sits in a normal SQL column.",
      },
      {
        title: "Read server-side only",
        body: "The ETL jobs fetch the token from Vault at run time on the server. It is never serialized into a page, an API response, or anything the browser can see.",
      },
      {
        title: "Non-secret config stays plain",
        body: "Ad-account id, location id, and result type are ordinary columns — leaving the token field blank on save updates those without disturbing the stored secret.",
      },
    ],
    security: {
      body: "Tokens are encrypted at rest in Vault; clearing a credential deletes the underlying Vault secret, not just the row reference. The cron/ETL endpoints that consume them authenticate with a constant-time bearer-secret comparison.",
    },
    footnote: "Demo — credentials aren't editable here.",
  },

  pipeline: {
    title: "CRM pipeline mapping, in production",
    Icon: GitBranch,
    intro:
      "How raw Asera CRM stages become the dashboard funnel (Leads → Bookings → Shows → Conversions). No UUID copy-pasting — the pipeline is discovered, then mapped.",
    steps: [
      {
        title: "Discover",
        body: "The server calls the Asera API with this client's vaulted token and location id and lists their real pipelines in a dropdown — pick one by name.",
      },
      {
        title: "Map stages to phases",
        body: "Each stage in the chosen pipeline is assigned to a lifecycle phase (Booked / No Show / Showed / Converted, or ignored). Those mappings are what the funnel and every conversion rate are computed from.",
      },
    ],
    security: {
      body: "The token used for discovery is read from Vault on the server and never reaches the client; the mappings are written under the same tenant-scoped RLS as the rest of the client's data.",
    },
    footnote: "Demo — the pipeline mapping is read-only here.",
  },

  etl: {
    title: "Manual data pulls, in production",
    Icon: Database,
    intro:
      "The dashboard refreshes itself overnight, but an admin can force a pull here when they need numbers right now.",
    steps: [
      {
        title: "Server-side jobs",
        body: "Each button POSTs to a Node route — Meta backfills the maximum range (~36 months) and upserts overlapping days; Asera paginates every opportunity and upserts. The browser never touches a provider API.",
      },
      {
        title: "Also runs nightly",
        body: "The same jobs run on a 5 AM cron so the dashboard stays current without anyone clicking. Each run is recorded in etl_runs with row counts, duration, and any error.",
      },
    ],
    security: {
      body: "The cron/ETL endpoints verify a bearer secret with a constant-time comparison, a per-client cooldown plus in-flight guard keeps providers from being hammered, and every write lands under tenant-scoped RLS.",
    },
    footnote: "Demo — no real pull runs.",
  },

  "funnel-labels": {
    title: "Funnel stage labels, in production",
    Icon: Tags,
    intro:
      "Per-client renames for the four funnel stages, so a dental client reads \"Booking\" where a law firm reads \"Consult\".",
    steps: [
      {
        title: "Display-only renames",
        body: "These labels change how the four lifecycle phases are titled across the dashboard funnel. The underlying phase keys (booked / no_show / showed / converted) stay constant, so the math is unaffected.",
      },
    ],
    security: {
      body: "Writing labels requires the Ads capability on this client and is validated server-side; a scoped admin without it can't reach the action.",
    },
    footnote: "Demo — labels aren't editable here.",
  },

  "funnel-goals": {
    title: "Funnel goals, in production",
    Icon: Target,
    intro:
      "Stage-to-stage conversion-rate targets. They're what turn each funnel pill green, amber, or red on the dashboard.",
    steps: [
      {
        title: "Targets, not data",
        body: "Set a goal for each transition (e.g. 60% of bookings should show). The dashboard compares the client's actual rate against the goal and colors the pill accordingly.",
      },
    ],
    security: {
      body: "Goals are a per-client setting written under tenant-scoped RLS, gated by the Ads capability and re-checked server-side.",
    },
    footnote: "Demo — goals aren't editable here.",
  },

  revenue: {
    title: "Revenue rules, in production",
    Icon: DollarSign,
    intro:
      "Per-client revenue adjustments — e.g. a flat consultation fee counted on every show — folded into the dashboard's revenue math.",
    steps: [
      {
        title: "Folded into the totals",
        body: "A rule like \"$67 per show\" is applied when revenue is summed, so the dashboard reflects the client's real economics without re-tagging individual opportunities.",
      },
    ],
    security: {
      body: "Rules are tenant-scoped and write through the same RLS + capability checks as the rest of the Ads settings.",
    },
    footnote: "Demo — revenue rules aren't editable here.",
  },

  "social-oauth": {
    title: "Connecting social accounts, in production",
    Icon: Link2,
    intro:
      "Each platform is linked through its own OAuth — Facebook Business Login, Google, TikTok Login Kit. Connect, reconnect, and disconnect all run here in the live product.",
    steps: [
      {
        title: "Tenant-bound OAuth",
        body: "/api/auth/<platform>/start signs this client's id into the OAuth state with an HMAC keyed by a server-only secret. The callback verifies it in constant time and derives the client from the verified state, so a forged or replayed callback can't repoint a grant at another tenant. TikTok adds PKCE.",
      },
      {
        title: "Read-only scopes",
        body: "Relay requests only read-analytics scopes — it never posts, messages, or changes anything. Meta links a Facebook Page plus its connected Instagram in one grant; YouTube comes through Google; TikTok through the Display API.",
      },
      {
        title: "Disconnect is local",
        body: "Disconnecting deletes the stored Vault secret and the credential row but intentionally does not revoke the grant on the platform side — Relay never silently changes a setting inside the user's Meta or Google account.",
      },
    ],
    security: {
      body: "Access and refresh tokens are encrypted in Supabase Vault — only an opaque vault id is stored, and a token value never reaches the browser. Going live meant passing each platform's app review (Meta, TikTok, Google).",
    },
    footnote: "Demo — accounts are pre-connected to synthetic data; no OAuth runs.",
  },

  lifecycle: {
    title: "Client lifecycle, in production",
    Icon: Power,
    intro:
      "Pause, delete, restore, and permanently delete a client. The reversible actions are one click; the irreversible one is deliberately not.",
    steps: [
      {
        title: "Soft transitions",
        body: "Pause / Delete / Restore just flip a status column. The cron skips non-active clients, their users are treated as no-access by the auth gate, and all data is preserved — fully reversible from this same panel.",
      },
      {
        title: "Permanent delete is gated",
        body: "Hard delete is only reachable from the already-deleted state, behind a type-the-exact-slug confirmation. It cascades through every child table, wipes the Vault secrets that live outside the FK graph, and removes the uploaded logo from storage.",
      },
    ],
    security: {
      body: "Lifecycle changes are global-super-admin-only — a scoped local admin sees the buttons disabled, and the server action re-checks the role. The typed-slug match is validated again server-side, so the confirmation can't be skipped with a crafted request.",
    },
    footnote: "Demo — lifecycle actions are disabled here.",
  },

  "seo-settings": {
    title: "Web & SEO connections, in production",
    Icon: Search,
    intro:
      "Where a client's Search Console, GA4, Bing, and local-rank grid get wired up so the Web & SEO tab has data to show.",
    steps: [
      {
        title: "Pick from the source, not by id",
        body: "Connected Google/Bing accounts are listed by name so an admin picks the right GSC site, GA4 property, and Bing site from a dropdown rather than pasting opaque ids.",
      },
      {
        title: "Local-rank grid",
        body: "For SEO clients, a BrightLocal geo-grid report is linked by business name; the daily pull then renders the local-rank heatmap and competitor table.",
      },
    ],
    security: {
      body: "Provider access is OAuth read-only and the tokens are handled server-side; every settings write and data read is tenant-scoped by RLS and gated on the Web capability.",
    },
    footnote: "Demo — connections aren't editable here.",
  },
};

/** Shown if a form somehow resolves to no known section key. */
export const FALLBACK_EXPLAINER: ExplainerContent = {
  title: "Disabled in the demo",
  Icon: KeyRound,
  intro:
    "This control performs a real change in the live product. In this public demo it's intentionally inert so the synthetic data stays put.",
  footnote: "Demo — this action doesn't run.",
};
