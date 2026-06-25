/**
 * POST /api/report/<clientId>
 *
 * Generates a branded Relay PDF report for the selected services over
 * the given date range, and returns it as a download. Auth: any viewer of the
 * client (super_admin / admin / matching client_user).
 *
 * Phase 1 wires the cover + Ads page to live data; Socials and Web & SEO render
 * as placeholders until their live-data adapters land.
 */
import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { getCurrentUser, resolveAccess, type AccessResult, type ResolvedClient } from "@/lib/auth";
import { gatherAdsData, rangeLabel, priorRangeLabel } from "@/lib/report/ads-data";
import { gatherSocialsData } from "@/lib/report/socials-data";
import { gatherSeoData } from "@/lib/report/seo-data";
import {
  coverPage,
  adsPage,
  socialsPage,
  seoPage,
  localMapPage,
  assembleReport,
  type ReportMeta,
  type TocItem,
} from "@/lib/report/templates";
import { htmlToPdf } from "@/lib/report/render";

// puppeteer needs the Node runtime; Chrome can take >25s on cold start.
export const runtime = "nodejs";
export const maxDuration = 60;

type Product = "ads" | "socials" | "web";
const ORDER: Product[] = ["ads", "socials", "web"];
const META: Record<Product, { name: string; desc: string; icon: TocItem["icon"]; eyebrow: string; title: string }> = {
  ads: { name: "Paid Advertising", desc: "Spend, revenue, ROAS & your conversion funnel", icon: "ads", eyebrow: "Paid Advertising", title: "Ad Performance" },
  socials: { name: "Organic Social", desc: "Followers, reach, engagement & top content", icon: "social", eyebrow: "Organic Social", title: "Social Performance" },
  web: { name: "Web & SEO", desc: "Search visibility, website analytics & rankings", icon: "web", eyebrow: "Web & SEO", title: "Search & Website" },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Hosts we must never fetch server-side (SSRF guard): loopback, link-local +
 *  cloud metadata (169.254.169.254), and RFC-1918 private ranges. */
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true; // loopback / private / this-host
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
  }
  return false;
}

/**
 * Fetch an image (resolving relative paths against the request origin) and
 * return it as a base64 data URI so the headless renderer never has to resolve
 * a relative/auth-gated URL. Returns null on any failure → the cover falls back
 * to the client's initial tile.
 *
 * SSRF hardening (audit 2026): only http(s); never fetch a private/link-local/
 * metadata host; and forward the caller's session cookie ONLY to our own origin
 * (a logo on Supabase storage is public and needs no cookie — forwarding it would
 * leak the httpOnly session to a third-party host).
 */
async function inlineImage(
  rawUrl: string | null,
  origin: string,
  cookie: string | null,
): Promise<string | null> {
  if (!rawUrl) return null;
  try {
    const appOrigin = new URL(origin).origin;
    const target = new URL(rawUrl, origin);
    if (target.protocol !== "https:" && target.protocol !== "http:") return null;
    if (isBlockedHost(target.hostname)) return null;
    const sameOrigin = target.origin === appOrigin;
    const res = await fetch(target.toString(), {
      cache: "no-store",
      headers: sameOrigin && cookie ? { cookie } : {},
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/png";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 3_000_000) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function findViewableClient(access: AccessResult, clientId: string): ResolvedClient | null {
  if (access.kind === "super_admin" || access.kind === "admin") {
    return access.allClients.find((c) => c.id === clientId) ?? null;
  }
  if (access.kind === "client_user" && access.client.id === clientId) return access.client;
  return null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await ctx.params;

  const user = await getCurrentUser();
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await resolveAccess(user.email);
  const client = findViewableClient(access, clientId);
  if (!client) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { services?: unknown; start?: unknown; end?: unknown; localMaps?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const start = String(body.start ?? "");
  const end = String(body.end ?? "");
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end) || start > end) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  // Selected products ∩ what the client is entitled to, in canonical order.
  const requested = new Set(Array.isArray(body.services) ? body.services.map(String) : []);
  const included = ORDER.filter(
    (k) => requested.has(k) && client.enabled_services.includes(k),
  );
  if (included.length === 0) {
    return NextResponse.json({ error: "Select at least one service" }, { status: 400 });
  }

  const clientLogoUrl = await inlineImage(
    client.brand_logo_url,
    req.nextUrl.origin,
    req.headers.get("cookie"),
  );

  const meta: ReportMeta = {
    clientName: client.name,
    clientLogoUrl,
    periodLabel: rangeLabel(start, end),
    comparisonLabel: priorRangeLabel(start, end),
    generatedLabel: format(new Date(), "MMMM d, yyyy"),
  };

  try {
    // Gather live data for each selected product.
    const wantLocal = Boolean(body.localMaps) && included.includes("web");
    const adsData = included.includes("ads") ? await gatherAdsData(client, start, end) : null;
    const socialsData = included.includes("socials") ? await gatherSocialsData(client, start, end) : null;
    const seoResult = included.includes("web") ? await gatherSeoData(client, start, end, wantLocal) : null;

    // Flatten into an ordered list of page "slots". Web expands into the Search
    // & Website page plus one Local Map page per tracked keyword (when wanted).
    type Slot = { toc?: Omit<TocItem, "page">; build: (page: number) => string };
    const slots: Slot[] = [];
    for (const k of included) {
      if (k === "ads" && adsData) {
        slots.push({ toc: { icon: META.ads.icon, name: META.ads.name, desc: META.ads.desc }, build: (pg) => adsPage(meta, adsData, pg) });
      } else if (k === "socials" && socialsData) {
        slots.push({ toc: { icon: META.socials.icon, name: META.socials.name, desc: META.socials.desc }, build: (pg) => socialsPage(meta, socialsData, pg) });
      } else if (k === "web" && seoResult) {
        slots.push({ toc: { icon: META.web.icon, name: META.web.name, desc: META.web.desc }, build: (pg) => seoPage(meta, seoResult.page, pg) });
        const kws = seoResult.localKeywords;
        kws.forEach((kw, i) => {
          slots.push({
            toc: i === 0 ? { icon: "web", name: "Local Map Rankings", desc: `Google map rank grids · ${kws.length} keyword${kws.length > 1 ? "s" : ""}` } : undefined,
            build: (pg) => localMapPage(meta, kw, pg),
          });
        });
      }
    }

    // Cover is page 1; slots follow in order.
    const toc: TocItem[] = [];
    const servicePages: string[] = slots.map((s, i) => {
      const page = 2 + i;
      if (s.toc) toc.push({ ...s.toc, page });
      return s.build(page);
    });

    const html = assembleReport([coverPage(meta, toc, 1), ...servicePages], {
      leaflet: (seoResult?.localKeywords.length ?? 0) > 0,
    });

    const pdf = await htmlToPdf(html);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${client.slug}-report-${end}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // Log the real cause server-side; return only a correlation id so internal
    // infra detail (Chromium pack URL, file paths, dep versions) never leaks in
    // the response body. Operators grep the errorId in the function logs.
    const errorId = crypto.randomUUID();
    console.error(`[report] failed (errorId=${errorId})`, e);
    return NextResponse.json(
      { error: "Report failed", errorId },
      { status: 500 },
    );
  }
}
