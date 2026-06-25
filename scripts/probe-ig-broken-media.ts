/**
 * READ-ONLY probe: why does an Instagram post render the broken-media page?
 *
 * Inspects the stored social_posts rows for a client's Instagram media and, for
 * each, checks the two things the detail modal depends on:
 *   1. thumbnail_url  — HEAD the stored CDN url; an expired IG signed url 403s
 *      (that's a broken <img>, the static path).
 *   2. permalink/embed — GET `${permalink}/embed`; IG serves its branded
 *      "link to this photo or video may be broken" page (the iframe path) when
 *      the post isn't embeddable. We sniff the returned HTML for that copy.
 *
 * Prints per-post: posted_at, media_type, reach_kind, fetched_at, permalink,
 * thumbnail host, thumbnail HEAD status, and embed verdict.
 *
 * SELECT-only on our DB. Outbound GETs hit only public IG CDN / embed urls (no
 * token, no PII). Safe on prod.
 * Usage: npx tsx --env-file=.env.local scripts/probe-ig-broken-media.ts [slug]
 */
import { createClient } from "@supabase/supabase-js";

const SLUG = process.argv[2] ?? "st-louis-sports-clinic";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

type PostRow = {
  post_id: string;
  posted_at: string;
  permalink: string | null;
  thumbnail_url: string | null;
  media_type: string | null;
  reach_kind: string | null;
  fetched_at: string | null;
};

/** HEAD a url; return status + a short note. Never throws. */
async function head(u: string): Promise<string> {
  try {
    const res = await fetch(u, { method: "GET", redirect: "manual" });
    // IG CDN returns the bytes on 200, a 403 "URL signature expired" otherwise.
    return `${res.status}`;
  } catch (e) {
    return `ERR ${(e instanceof Error ? e.message : String(e)).slice(0, 40)}`;
  }
}

/** GET `${permalink}/embed`; sniff for IG's broken-media copy. Never throws. */
async function probeEmbed(permalink: string): Promise<string> {
  const base = permalink.replace(/\/+$/, "");
  const embedUrl = `${base}/embed`;
  try {
    const res = await fetch(embedUrl, {
      method: "GET",
      headers: {
        // IG gates embeds on a browser-ish UA; without it you can get a
        // different (login-wall) response than the iframe does.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
    });
    const html = (await res.text()).toLowerCase();
    const broken =
      html.includes("may be broken") ||
      html.includes("the link to this photo") ||
      html.includes("post may have been removed");
    const hasEmbedMedia =
      html.includes("embedsmediawrapper") || html.includes("class=\"embed");
    return `${res.status} ${broken ? "BROKEN-PAGE" : hasEmbedMedia ? "embeddable" : "?(" + html.length + "b)"}`;
  } catch (e) {
    return `ERR ${(e instanceof Error ? e.message : String(e)).slice(0, 40)}`;
  }
}

function hostOf(u: string | null): string {
  if (!u) return "(null)";
  try { return new URL(u).host; } catch { return "(unparseable)"; }
}

async function main() {
  const { data: client } = await sb
    .from("clients").select("id, name").eq("slug", SLUG).maybeSingle();
  if (!client) {
    const { data: all } = await sb.from("clients").select("slug, name").order("slug");
    console.error(`No client "${SLUG}". Available slugs:`);
    for (const c of all ?? []) console.error(`  ${String(c.slug).padEnd(28)} ${c.name}`);
    process.exit(1);
  }
  const id = client.id as string;
  console.log(`\n══ IG broken-media probe — "${SLUG}" (${client.name}) ══\n`);

  const { data, error } = await sb
    .from("social_posts")
    .select("post_id, posted_at, permalink, thumbnail_url, media_type, reach_kind, fetched_at")
    .eq("client_id", id)
    .eq("platform", "meta_instagram")
    .order("posted_at", { ascending: false })
    .limit(40);
  if (error) { console.error("query failed:", error.message); process.exit(1); }
  const rows = (data ?? []) as PostRow[];
  console.log(`stored meta_instagram posts: ${rows.length}\n`);

  for (const r of rows) {
    const posted = r.posted_at?.slice(0, 10) ?? "?";
    const fetched = r.fetched_at?.slice(0, 16).replace("T", " ") ?? "?";
    const permPath = r.permalink ? new URL(r.permalink).pathname : "(null)";
    const thumbStatus = r.thumbnail_url ? await head(r.thumbnail_url) : "(no thumb)";
    const embedVerdict = r.permalink ? await probeEmbed(r.permalink) : "(no permalink)";
    console.log(
      `${posted}  ${String(r.media_type).padEnd(8)} ${String(r.reach_kind).padEnd(7)} ` +
      `fetched=${fetched}\n` +
      `   permalink: ${permPath}\n` +
      `   thumb:     ${hostOf(r.thumbnail_url)}  → HEAD ${thumbStatus}\n` +
      `   embed:     ${embedVerdict}\n`,
    );
  }
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
