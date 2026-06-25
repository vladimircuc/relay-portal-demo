/**
 * READ-ONLY probe: does IG's Graph API give us a directly-playable MP4 for
 * reels/videos? If `media_url` on a VIDEO/REELS media is an actual mp4 (vs a
 * thumbnail), we can play it inline in a native <video> tag — no flaky IG
 * /embed iframe. Confirms content-type + size + whether the url is alive.
 *
 * Uses the stored Page token (in-process, NEVER printed). SELECT on our DB +
 * read-only Graph GET + HEAD on the returned CDN urls. Hard 12s timeout per
 * fetch and an explicit process.exit so it can't hang on keep-alive sockets.
 * Usage: npx tsx --env-file=.env.local scripts/probe-ig-video-url.ts [slug]
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";
import { META_API_VERSION } from "../src/lib/meta-oauth";

const SLUG = process.argv[2] ?? "stl-sports-clinic";
const G = `https://graph.facebook.com/${META_API_VERSION}`;

/** fetch with a hard timeout so a stalled connection can't hang the probe. */
async function tfetch(url: string, init: RequestInit = {}, ms = 12_000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const supabase = createAdminClient();
  const { data: client } = await supabase
    .from("clients").select("id, name").eq("slug", SLUG).maybeSingle();
  if (!client) throw new Error(`No client with slug ${SLUG}`);

  const { data: creds } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id, ig_user_id, ig_username")
    .eq("client_id", (client as { id: string }).id).eq("platform", "meta").maybeSingle();
  if (!creds) throw new Error("No meta credentials for this client");
  const c = creds as { access_token_secret_id: string; ig_user_id: string | null; ig_username: string | null };
  if (!c.ig_user_id) throw new Error("No IG user id connected");

  const token = await getVaultSecret(supabase, c.access_token_secret_id);
  console.log(`\n══ IG video-url probe — "${SLUG}" (@${c.ig_username}) ══\n`);

  const fields = "id,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
  const r = await tfetch(`${G}/${c.ig_user_id}/media?fields=${fields}&limit=12&access_token=${token}`);
  const body = (await r.json()) as { data?: Array<Record<string, unknown>> };
  const media = (body.data ?? []).filter(
    (m) => m.media_type === "VIDEO" || m.media_product_type === "REELS",
  );
  console.log(`videos/reels in latest 12: ${media.length}\n`);

  for (const m of media.slice(0, 6)) {
    const mediaUrl = m.media_url as string | undefined;
    const permPath = m.permalink ? new URL(String(m.permalink)).pathname : "(none)";
    let verdict = "(no media_url)";
    if (mediaUrl) {
      try {
        const h = await tfetch(mediaUrl, { method: "GET", headers: { Range: "bytes=0-0" } });
        verdict = `HTTP ${h.status}  type=${h.headers.get("content-type")}  len=${h.headers.get("content-range") ?? h.headers.get("content-length")}`;
      } catch (e) {
        verdict = `ERR ${(e instanceof Error ? e.message : String(e)).slice(0, 50)}`;
      }
    }
    console.log(
      `${String(m.timestamp).slice(0, 10)}  ${String(m.media_product_type || m.media_type).padEnd(7)} ${permPath}\n` +
      `   media_url host: ${mediaUrl ? new URL(mediaUrl).host : "(null)"}\n` +
      `   media_url GET:  ${verdict}\n`,
    );
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FATAL:", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
