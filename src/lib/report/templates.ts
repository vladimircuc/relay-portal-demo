/**
 * Pure HTML builders for the PDF report pages. NO server imports — these take
 * already-gathered data and return HTML strings, so they can be unit-rendered
 * in isolation. Markup is ported verbatim from the approved prototypes
 * (report-proto/cover.html + ads-chevron.html).
 */
import { REPORT_STYLES } from "./styles";
import { COVER_BANNER, WATERMARK, LOGO_BLACK, SOCIAL_LOGOS } from "./assets-data";

const FOOTER_ADDR =
  "<b>Relay</b> &nbsp;|&nbsp; 1203 Tower Grove Ave, St. Louis, MO 63110 &nbsp;|&nbsp; vladimircuc.com";

// ── formatting helpers ──────────────────────────────────────────────────────
const finite = (n: number) => Number.isFinite(n);
const safeDiv = (a: number, b: number) => (b ? a / b : NaN);

/** "$4,820" above 100, "$76.51" below; "—" when not finite. */
export function money(n: number): string {
  if (!finite(n)) return "—";
  return Math.abs(n) >= 100
    ? "$" + Math.round(n).toLocaleString("en-US")
    : "$" + n.toFixed(2);
}
/** 286500 → "286.5K", 1_240_000 → "1.2M", <1000 → "1,240". */
export function compact(n: number): string {
  if (!finite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toLocaleString("en-US");
}
export function int(n: number): string {
  return finite(n) ? Math.round(n).toLocaleString("en-US") : "—";
}
export function roasFmt(n: number): string {
  return finite(n) ? n.toFixed(1) + "×" : "—";
}
/** Short percent: drops a trailing ".0" (60.3% / 46% / 100%). */
export function pctShort(frac: number): string {
  if (!finite(frac)) return "—";
  const v = frac * 100;
  const s = v.toFixed(1);
  return (s.endsWith(".0") ? s.slice(0, -2) : s) + "%";
}

/** A delta pill. `value` is fractional (0.184 = +18.4%); null hides it.
 *  invert=true means a DECREASE is good (cost metrics). */
export function deltaPill(value: number | null | undefined, invert = false): string {
  if (value == null || !finite(value)) return "";
  const up = value > 0;
  const good = invert ? !up : up;
  const arrow = up ? "▲" : "▼";
  const cls = good ? "good" : "bad";
  return `<span class="delta ${cls}"><span class="arw">${arrow}</span>${(Math.abs(value) * 100).toFixed(1)}%</span>`;
}

const lastWord = (s: string) => s.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
// Escapes for HTML *attribute* context too (the cover interpolates the client
// name into alt="..."). Without escaping " and ', a name like `Acme" onerror=...`
// breaks out of the attribute and injects a handler in the headless-Chrome render.
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// ── types ────────────────────────────────────────────────────────────────────
export type ReportMeta = {
  clientName: string;
  clientLogoUrl: string | null;
  periodLabel: string;
  comparisonLabel: string;
  generatedLabel: string;
};

export type TocItem = { icon: "ads" | "social" | "web"; name: string; desc: string; page: number };

export type AdsData = {
  spend: number;
  revenue: number;
  roas: number;
  leads: number;
  costPerLead: number;
  conversions: number;
  costPerConversion: number;
  deltas: {
    spend: number | null;
    revenue: number | null;
    roas: number | null;
    leads: number | null;
    costPerLead: number | null;
    conversions: number | null;
    costPerConversion: number | null;
  };
  funnel: {
    leads: number;
    bookingLabel: string; // pluralized
    bookings: number;
    showLabel: string; // pluralized
    shows: number;
    conversions: number;
  };
};

// ── TOC icons (inline so no asset deps) ──────────────────────────────────────
const TOC_ICON: Record<TocItem["icon"], string> = {
  ads: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`,
  social: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>`,
  web: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
};

function footer(page: number): string {
  return `<div class="foot"><div class="rule"></div><div class="frow"><span>${FOOTER_ADDR}</span><span>Page ${page}</span></div></div>`;
}

// ── cover ─────────────────────────────────────────────────────────────────────
export function coverPage(meta: ReportMeta, toc: TocItem[], page: number): string {
  const logo = meta.clientLogoUrl
    ? `<span class="tile"><img src="${esc(meta.clientLogoUrl)}" alt="${esc(meta.clientName)}" /></span>`
    : `<span class="tile initial">${esc(meta.clientName.trim().charAt(0).toUpperCase() || "?")}</span>`;

  const tocRows = toc
    .map(
      (t, i) => `
      <div class="toc-item${i === 0 ? " first" : ""}">
        <div class="toc-dot">${TOC_ICON[t.icon]}</div>
        <div><div class="toc-name">${esc(t.name)}</div><div class="toc-desc">${esc(t.desc)}</div></div>
        <div class="toc-pg">Page ${t.page}</div>
      </div>`,
    )
    .join("");

  return `
  <section class="page cover">
    <img class="banner" src="${COVER_BANNER}" alt="Relay" />
    <img class="watermark" src="${WATERMARK}" alt="" />
    <div class="body">
      <p class="eyebrow">Performance Report</p>
      <div class="identity">${logo}<h1 class="title">${esc(meta.clientName)}</h1></div>
      <p class="period">${esc(meta.periodLabel)}</p>
      <p class="compare">Compared to ${esc(meta.comparisonLabel)}</p>
      <div class="toc"><p class="toc-h">In this report</p>${tocRows}</div>
      <div class="prepared">Prepared by <b>Relay</b><br/>Generated ${esc(meta.generatedLabel)}</div>
    </div>
    ${footer(page)}
  </section>`;
}

// ── ads ───────────────────────────────────────────────────────────────────────
export function adsPage(meta: ReportMeta, d: AdsData, page: number): string {
  const f = d.funnel;
  const rBook = safeDiv(f.bookings, f.leads);
  const rShow = safeDiv(f.shows, f.bookings);
  const rConv = safeDiv(f.conversions, f.shows);
  const ofLeadsBook = safeDiv(f.bookings, f.leads);
  const ofLeadsShow = safeDiv(f.shows, f.leads);
  const ofLeadsConv = safeDiv(f.conversions, f.leads);

  // generic, robust summary — no industry-specific wording
  const roasClause =
    d.deltas.roas != null && finite(d.deltas.roas)
      ? `, ${d.deltas.roas >= 0 ? "up" : "down"} ${(Math.abs(d.deltas.roas) * 100).toFixed(1)}% versus the prior period`
      : "";
  const summary = `This period you invested <b>${money(d.spend)}</b> in paid advertising and generated <b>${money(
    d.revenue,
  )}</b> in attributed revenue — a <b>${roasFmt(d.roas)} return on ad spend</b>${roasClause}. Your campaigns delivered <b>${int(
    d.leads,
  )} leads</b> at <b>${money(d.costPerLead)}</b> each, and <b>${int(f.conversions)} converted</b>.`;

  return `
  <section class="page rpage ads">
    <img class="watermark" src="${WATERMARK}" alt="" />
    <div class="phead"><div class="accent-bar"></div><img class="logo" src="${LOGO_BLACK}" alt="Relay" /></div>
    <div class="content">
      <p class="eyebrow">Paid Advertising</p>
      <h1 class="h1y">Ad Performance</h1>
      <p class="sub">${esc(meta.clientName)} &nbsp;·&nbsp; ${esc(meta.periodLabel)} &nbsp;·&nbsp; Compared to ${esc(meta.comparisonLabel)}</p>
      <p class="summary">${summary}</p>

      <div class="block">
        <div class="eq-row">
          <div class="eq-cell">
            <p class="eq-label">Ad Spend</p>
            <p class="eq-value">${money(d.spend)}</p>
            <div class="eq-foot">${deltaPill(d.deltas.spend)}</div>
            <span class="eq-op">→</span>
          </div>
          <div class="eq-cell">
            <p class="eq-label">Revenue Generated</p>
            <p class="eq-value">${money(d.revenue)}</p>
            <div class="eq-foot">${deltaPill(d.deltas.revenue)}</div>
            <span class="eq-op">=</span>
          </div>
          <div class="eq-cell punch">
            <p class="eq-label">Return on Ad Spend</p>
            <p class="eq-value">${roasFmt(d.roas)}</p>
            <div class="eq-foot">${deltaPill(d.deltas.roas)}</div>
          </div>
        </div>
        <div class="mid-rule"></div>
        <div class="kpi-row">
          <div class="kpi-cell"><p class="kpi-label">Leads</p><p class="kpi-value">${int(d.leads)}</p><div class="kpi-foot">${deltaPill(d.deltas.leads)}</div></div>
          <div class="kpi-cell"><p class="kpi-label">Cost per Lead</p><p class="kpi-value">${money(d.costPerLead)}</p><div class="kpi-foot">${deltaPill(d.deltas.costPerLead, true)}</div></div>
          <div class="kpi-cell"><p class="kpi-label">Conversions</p><p class="kpi-value">${int(d.conversions)}</p><div class="kpi-foot">${deltaPill(d.deltas.conversions)}</div></div>
          <div class="kpi-cell"><p class="kpi-label">Cost per Conversion</p><p class="kpi-value">${money(d.costPerConversion)}</p><div class="kpi-foot">${deltaPill(d.deltas.costPerConversion, true)}</div></div>
        </div>
      </div>

      <div class="funnel-head">
        <p class="funnel-title">Conversion Funnel</p>
        <p class="funnel-sub">How this period's leads progressed through each stage</p>
      </div>
      <div class="funnel-zone">
        <div class="conv-track">
          <span class="cm" style="left:37.5%"><span class="arw">▶</span><span class="pct">${pctShort(rBook)}</span><span class="of">of leads</span></span>
          <span class="cm" style="left:62.5%"><span class="arw">▶</span><span class="pct">${pctShort(rShow)}</span><span class="of">of ${esc(lastWord(f.bookingLabel))}</span></span>
          <span class="cm" style="left:87.5%"><span class="arw">▶</span><span class="pct">${pctShort(rConv)}</span><span class="of">of ${esc(lastWord(f.showLabel))}</span></span>
        </div>
        <div class="chev-wrap">
          <div class="chev c1"><div class="body"><p class="label">Leads</p><span class="count">${int(f.leads)}</span><span class="ofpct">100% of leads</span></div></div>
          <div class="chev c2"><div class="body"><p class="label">${esc(f.bookingLabel)}</p><span class="count">${int(f.bookings)}</span><span class="ofpct">${pctShort(ofLeadsBook)} of leads</span></div></div>
          <div class="chev c3"><div class="body"><p class="label">${esc(f.showLabel)}</p><span class="count">${int(f.shows)}</span><span class="ofpct">${pctShort(ofLeadsShow)} of leads</span></div></div>
          <div class="chev c4"><div class="body"><p class="label">Conversions</p><span class="count">${int(f.conversions)}</span><span class="ofpct">${pctShort(ofLeadsConv)} of leads</span></div></div>
        </div>
      </div>
      <div class="funnel-foot">
        <span class="ff-item">Counts shown in each stage; <b>%</b> = stage-to-stage conversion.</span>
        <span class="ff-item">Overall conversion: <b>${pctShort(ofLeadsConv)}</b></span>
      </div>
    </div>
    ${footer(page)}
  </section>`;
}

// ── SOCIAL ────────────────────────────────────────────────────────────────────
export type SocialPlatformKey = keyof typeof SOCIAL_LOGOS;
export type SocialsData = {
  followers: number; followersDelta: number | null;
  impressions: number; impressionsDelta: number | null;
  engagements: number; engagementsDelta: number | null;
  profileVisits: number; profileVisitsDelta: number | null;
  linkClicks: number; linkClicksDelta: number | null;
  platforms: Array<{
    platform: SocialPlatformKey;
    label: string;
    followers: number;
    reachViews: number | null;
    engagements: number | null;
    profileVisits: number | null;
    linkClicks: number | null;
  }>;
  topByEngagements: Array<{ tag: string; caption: string; metric: string }>;
  topByViews: Array<{ tag: string; caption: string; metric: string }>;
};

function naCell(v: number | null, fmt: (n: number) => string): string {
  return v == null ? `<td class="na">—</td>` : `<td>${fmt(v)}</td>`;
}

export function socialsPage(meta: ReportMeta, d: SocialsData, page: number): string {
  const kpi = (label: string, value: string, delta: number | null) =>
    `<div class="kpi-cell"><p class="kpi-label">${label}</p><p class="kpi-value">${value}</p><div class="kpi-foot">${deltaPill(delta)}</div></div>`;

  const platformRows = d.platforms
    .map(
      (p) => `<tr>
        <td class="plat"><span><img src="${SOCIAL_LOGOS[p.platform]}" alt="" />${esc(p.label)}</span></td>
        <td>${int(p.followers)}</td>
        ${naCell(p.reachViews, compact)}
        ${naCell(p.engagements, int)}
        ${naCell(p.profileVisits, int)}
        ${naCell(p.linkClicks, int)}
      </tr>`,
    )
    .join("");

  const tcRows = (items: SocialsData["topByEngagements"]) =>
    items.length
      ? items
          .map(
            (t, i) => `<div class="tc-row"><span class="tc-rank">${i + 1}</span><div class="tc-main"><div class="tc-tag">${esc(t.tag)}</div><div class="tc-cap">${esc(t.caption)}</div></div><span class="tc-metric">${esc(t.metric)}</span></div>`,
          )
          .join("")
      : `<div class="tc-row"><span class="tc-cap" style="color:var(--muted-2)">No posts in this period.</span></div>`;

  return `
  <section class="page rpage social">
    <img class="watermark" src="${WATERMARK}" alt="" />
    <div class="phead"><div class="accent-bar"></div><img class="logo" src="${LOGO_BLACK}" alt="Relay" /></div>
    <div class="content">
      <p class="eyebrow">Organic Social</p>
      <h1 class="h1y">Social Performance</h1>
      <p class="sub">${esc(meta.clientName)} &nbsp;·&nbsp; ${esc(meta.periodLabel)} &nbsp;·&nbsp; Compared to ${esc(meta.comparisonLabel)}</p>
      <p class="summary">Across your connected social platforms you reached <b>${compact(d.impressions)}</b> and earned <b>${int(
        d.engagements,
      )} engagements</b> this period${
        d.followersDelta != null ? `, with your audience now at <b>${int(d.followers)}</b>` : ""
      }.</p>

      <div class="block"><div class="kpi-row">
        ${kpi("Followers", int(d.followers), d.followersDelta)}
        ${kpi("Impressions", compact(d.impressions), d.impressionsDelta)}
        ${kpi("Engagements", int(d.engagements), d.engagementsDelta)}
        ${kpi("Profile Visits", int(d.profileVisits), d.profileVisitsDelta)}
        ${kpi("Link Clicks", int(d.linkClicks), d.linkClicksDelta)}
      </div></div>

      <h2 class="sec-head">By platform</h2>
      <table class="ptable">
        <thead><tr>
          <th class="lead">Platform</th><th>Followers</th><th>Reach / Views</th><th>Engagements</th><th>Profile Visits</th><th>Link Clicks</th>
        </tr></thead>
        <tbody>${platformRows}</tbody>
      </table>

      <h2 class="sec-head">Top content this period</h2>
      <div class="tc-wrap">
        <div><p class="tc-h">By engagements</p>${tcRows(d.topByEngagements)}</div>
        <div><p class="tc-h">By views</p>${tcRows(d.topByViews)}</div>
      </div>
    </div>
    ${footer(page)}
  </section>`;
}

// ── WEB & SEO ─────────────────────────────────────────────────────────────────
export type SeoData = {
  search: {
    clicks: number; clicksDelta: number | null;
    impressions: number; impressionsDelta: number | null;
    aiCitations: number; aiCitationsDelta: number | null;
    ctr: number; ctrDelta: number | null; // ctr as a fraction (0..1)
    position: number; positionDelta: number | null; // lower is better
  };
  web: {
    sessions: number; sessionsDelta: number | null;
    users: number; usersDelta: number | null;
    conversions: number; conversionsDelta: number | null;
    engagementRate: number; engagementRateDelta: number | null; // fraction 0..1
  };
  topQueries: Array<{ query: string; clicks: number; position: number }>;
  topPages: Array<{ page: string; clicks: number }>;
  channels: Array<{ name: string; sessions: number }>;
};

const DONUT_PALETTE = ["#ff6a00", "#0f0f10", "#4a4a52", "#9aa0a8", "#c8ccd1", "#e2e4e7"];

function buildSeoDonut(channels: SeoData["channels"]): { circles: string; legend: string; total: number } {
  // top 5 channels by sessions, remainder collapsed into "Other"
  const sorted = [...channels].sort((a, b) => b.sessions - a.sessions);
  const head = sorted.slice(0, 5);
  const restTotal = sorted.slice(5).reduce((s, c) => s + c.sessions, 0);
  const items = restTotal > 0 ? [...head, { name: "Other", sessions: restTotal }] : head;
  const total = items.reduce((s, c) => s + c.sessions, 0) || 1;

  const R = 60;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const circles = items
    .map((it, i) => {
      const seg = (it.sessions / total) * C;
      const off = -acc;
      acc += seg;
      return `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${DONUT_PALETTE[i % DONUT_PALETTE.length]}" stroke-width="22" stroke-dasharray="${seg.toFixed(2)} ${(C - seg).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"/>`;
    })
    .join("");
  const pctStr = (n: number) => {
    const p = (n / total) * 100;
    return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
  };
  const legend = items
    .map(
      (it, i) =>
        `<div class="lrow"><span class="lsw" style="background:${DONUT_PALETTE[i % DONUT_PALETTE.length]}"></span><span class="lname">${esc(it.name)}</span><span class="lval">${int(it.sessions)}<span class="pct">${pctStr(it.sessions)}</span></span></div>`,
    )
    .join("");
  return { circles, legend, total };
}

export function seoPage(meta: ReportMeta, d: SeoData, page: number): string {
  const kpi = (label: string, value: string, delta: number | null, invert = false) =>
    `<div class="kpi-cell"><p class="kpi-label">${label}</p><p class="kpi-value">${value}</p><div class="kpi-foot">${deltaPill(delta, invert)}</div></div>`;
  const donut = buildSeoDonut(d.channels);

  const queryRows = d.topQueries.length
    ? d.topQueries
        .map((q) => `<tr><td class="q">${esc(q.query)}</td><td class="r">${int(q.clicks)}</td><td class="r">${q.position.toFixed(1)}</td></tr>`)
        .join("")
    : `<tr><td class="q" style="color:var(--muted-2)">No data</td><td class="r"></td><td class="r"></td></tr>`;
  const pageRows = d.topPages.length
    ? d.topPages
        .map((p) => `<tr><td class="q">${esc(p.page)}</td><td class="r" colspan="2">${int(p.clicks)}</td></tr>`)
        .join("")
    : `<tr><td class="q" style="color:var(--muted-2)">No data</td><td class="r" colspan="2"></td></tr>`;

  return `
  <section class="page rpage seo">
    <img class="watermark" src="${WATERMARK}" alt="" />
    <div class="phead"><div class="accent-bar"></div><img class="logo" src="${LOGO_BLACK}" alt="Relay" /></div>
    <div class="content">
      <p class="eyebrow">Web &amp; SEO</p>
      <h1 class="h1y">Search &amp; Website</h1>
      <p class="sub">${esc(meta.clientName)} &nbsp;·&nbsp; ${esc(meta.periodLabel)} &nbsp;·&nbsp; Compared to ${esc(meta.comparisonLabel)}</p>
      <p class="summary">Your website drew <b>${int(d.web.sessions)} visits</b> from <b>${int(
        d.web.users,
      )} people</b> this period, producing <b>${int(d.web.conversions)} conversions</b>. In search you earned <b>${int(
        d.search.clicks,
      )} clicks</b> from <b>${compact(d.search.impressions)} impressions</b> at an average position of <b>${d.search.position.toFixed(1)}</b>.</p>

      <h2 class="sec-head">Search visibility</h2>
      <div class="block"><div class="kpi-row">
        ${kpi("Clicks", int(d.search.clicks), d.search.clicksDelta)}
        ${kpi("Impressions", compact(d.search.impressions), d.search.impressionsDelta)}
        ${kpi("AI Citations", int(d.search.aiCitations), d.search.aiCitationsDelta)}
        ${kpi("CTR", pctShort(d.search.ctr), d.search.ctrDelta)}
        ${kpi("Avg Position", d.search.position.toFixed(1), d.search.positionDelta, true)}
      </div></div>

      <h2 class="sec-head">Website analytics</h2>
      <div class="block"><div class="kpi-row">
        ${kpi("Sessions", int(d.web.sessions), d.web.sessionsDelta)}
        ${kpi("Users", int(d.web.users), d.web.usersDelta)}
        ${kpi("Conversions", int(d.web.conversions), d.web.conversionsDelta)}
        ${kpi("Engagement Rate", pctShort(d.web.engagementRate), d.web.engagementRateDelta)}
      </div></div>

      <div class="cols2">
        <div>
          <h2 class="sec-head tight">Top search queries</h2>
          <table class="stable">
            <tr><td class="th" style="text-align:left">Query</td><td class="th r">Clicks</td><td class="th r">Pos.</td></tr>
            ${queryRows}
          </table>
        </div>
        <div>
          <h2 class="sec-head tight">Top pages</h2>
          <table class="stable">
            <tr><td class="th" style="text-align:left">Page</td><td class="th r" colspan="2">Clicks</td></tr>
            ${pageRows}
          </table>
        </div>
      </div>

      <h2 class="sec-head">Traffic sources</h2>
      <div class="ts-wrap">
        <div class="donut">
          <svg width="100%" height="100%" viewBox="0 0 160 160">
            <g transform="rotate(-90 80 80)">
              <circle cx="80" cy="80" r="60" fill="none" stroke="#f2f2f2" stroke-width="22"/>
              ${donut.circles}
            </g>
          </svg>
          <div class="ctr"><span class="n">${int(donut.total)}</span><span class="l">Sessions</span></div>
        </div>
        <div class="legend">${donut.legend}</div>
      </div>
    </div>
    ${footer(page)}
  </section>`;
}

// ── LOCAL MAP (one per keyword) ───────────────────────────────────────────────
export type LocalMapData = {
  keyword: string;
  /** The BrightLocal report's business/location name — distinguishes the report
   *  this grid belongs to when a client tracks several locations. */
  locationName: string | null;
  monthLabel: string;
  avgRank: number | null;
  totalPoints: number;
  bands: { top3: number; mid: number; low: number; none: number };
  center: { lat: number; lng: number };
  points: Array<{ lat: number; lng: number; rank: number; isBiz?: boolean }>;
  competitors: Array<{ rank: number; name: string; reviews: number | null; rating: number | null; isClient: boolean }>;
};

export function localMapPage(meta: ReportMeta, d: LocalMapData, page: number): string {
  const rank = (r: number | null) => (r == null ? "—" : r.toFixed(1));
  const compRows = d.competitors.length
    ? d.competitors
        .map(
          (c) =>
            `<tr class="${c.isClient ? "you" : ""}"><td class="rank">${c.rank}</td><td class="biz">${esc(c.name)}</td><td class="r">${c.reviews == null ? "—" : int(c.reviews)}</td><td class="r">${c.rating == null ? "—" : c.rating.toFixed(1)}<span class="star">★</span></td></tr>`,
        )
        .join("")
    : `<tr><td class="biz" colspan="4" style="color:var(--muted-2)">No competitor data</td></tr>`;

  const ptsJson = JSON.stringify(d.points);
  const centerJson = JSON.stringify([d.center.lat, d.center.lng]);

  return `
  <section class="page rpage local">
    <img class="watermark" src="${WATERMARK}" alt="" />
    <div class="phead"><div class="accent-bar"></div><img class="logo" src="${LOGO_BLACK}" alt="Relay" /></div>
    <div class="content">
      <p class="eyebrow">Local SEO</p>
      <h1 class="h1y">Local Map Rankings</h1>
      <p class="sub"><b style="color:var(--ink)">${esc(d.locationName ?? meta.clientName)}</b> &nbsp;·&nbsp; Keyword: &ldquo;${esc(d.keyword)}&rdquo; &nbsp;·&nbsp; ${esc(d.monthLabel)}</p>
      <p class="summary">We track where you appear in Google's local map across a grid of points around your business. For this keyword your <b>average map rank is ${rank(
        d.avgRank,
      )}</b> — and <b>${d.bands.top3} of ${d.totalPoints}</b> grid points place you in the top 3.</p>

      <div class="localwrap">
        <div id="map-${page}" class="rmap"></div>
        <div class="localstats">
          <p class="avg-label">Average Map Rank</p>
          <p class="avg-num">${rank(d.avgRank)}</p>
          <p class="avg-sub">Across all ${d.totalPoints} grid points</p>
          <div class="bands">
            <div class="brow"><span class="bdot" style="background:var(--green)"></span><span class="bname">Top 3 (1–3)</span><span class="bcount">${d.bands.top3} <span>points</span></span></div>
            <div class="brow"><span class="bdot" style="background:var(--amber)"></span><span class="bname">4–10</span><span class="bcount">${d.bands.mid} <span>points</span></span></div>
            <div class="brow"><span class="bdot" style="background:var(--red)"></span><span class="bname">11–19</span><span class="bcount">${d.bands.low} <span>points</span></span></div>
            <div class="brow"><span class="bdot" style="background:var(--gray)"></span><span class="bname">20+</span><span class="bcount">${d.bands.none} <span>points</span></span></div>
          </div>
        </div>
      </div>
      <p class="mapnote">Each pin shows your Google local-map rank at that point. Business location ringed in yellow. Map © OpenStreetMap contributors, © CARTO.</p>

      <h2 class="sec-head">Top competitors at this keyword</h2>
      <table class="ctable">
        <tr><td class="th">Rank</td><td class="th">Business</td><td class="th r">Reviews</td><td class="th r">Rating</td></tr>
        ${compRows}
      </table>
    </div>
    ${footer(page)}
    <script>
      (function(){
        var PTS = ${ptsJson};
        var CENTER = ${centerJson};
        function bandColor(r){ if(r<=0||r>=20) return '#6b7280'; if(r<=3) return '#22c55e'; if(r<=10) return '#f59e0b'; return '#ef4444'; }
        var map = L.map('map-${page}', { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, touchZoom:false, zoomSnap:0.25 });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom:19, subdomains:'abcd' }).addTo(map);
        var latlngs = [];
        PTS.forEach(function(p){
          var label = (p.rank<=0||p.rank>=20) ? '20+' : String(p.rank);
          var size = p.isBiz ? 30 : 26;
          var fs = (label.length>=3) ? 9 : (p.isBiz ? 13 : 12);
          var ring = p.isBiz ? 'border:3px solid #ff6a00;' : '';
          var html = '<div class="pin" style="background:'+bandColor(p.rank)+';'+ring+'width:'+size+'px;height:'+size+'px;font-size:'+fs+'px;letter-spacing:-0.3px;">'+label+'</div>';
          L.marker([p.lat,p.lng], { icon: L.divIcon({ html:html, className:'', iconSize:[size,size], iconAnchor:[size/2,size/2] }), interactive:false }).addTo(map);
          latlngs.push([p.lat,p.lng]);
        });
        if (latlngs.length) { map.fitBounds(L.latLngBounds(latlngs).pad(0.18)); }
        else { map.setView(CENTER, 12); }
        setTimeout(function(){ map.invalidateSize(); if(latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.18)); }, 150);
      })();
    </script>
  </section>`;
}

// ── placeholder (service selected but not yet wired to live data) ────────────
export function placeholderPage(
  meta: ReportMeta,
  opts: { eyebrow: string; title: string },
  page: number,
): string {
  return `
  <section class="page rpage ads">
    <img class="watermark" src="${WATERMARK}" alt="" />
    <div class="phead"><div class="accent-bar"></div><img class="logo" src="${LOGO_BLACK}" alt="Relay" /></div>
    <div class="content">
      <p class="eyebrow">${esc(opts.eyebrow)}</p>
      <h1 class="h1y">${esc(opts.title)}</h1>
      <p class="sub">${esc(meta.clientName)} &nbsp;·&nbsp; ${esc(meta.periodLabel)} &nbsp;·&nbsp; Compared to ${esc(meta.comparisonLabel)}</p>
      <div style="margin-top:2.6in;text-align:center;color:var(--muted);">
        <p style="font-size:14px;font-weight:700;color:var(--ink-2);margin:0;">Detailed ${esc(opts.title)} reporting is on the way.</p>
        <p style="font-size:12px;font-weight:500;margin:8px 0 0;">This section will appear here in your next report.</p>
      </div>
    </div>
    ${footer(page)}
  </section>`;
}

// ── document assembly ─────────────────────────────────────────────────────────
export function assembleReport(pagesHtml: string[], opts?: { leaflet?: boolean }): string {
  const leaflet = opts?.leaflet
    ? `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<title>Relay — Performance Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
${leaflet}
<style>${REPORT_STYLES}</style>
</head><body>
${pagesHtml.join("\n")}
</body></html>`;
}
