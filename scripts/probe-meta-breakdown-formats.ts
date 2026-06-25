/**
 * READ-ONLY one-off: find the request format Meta accepts for the
 * is_from_ads breakdown on the new *_media_view metrics (v25.0). The
 * period=day time-series format rejects breakdowns ("unknown error"); the
 * newer breakdown system wants metric_type=total_value. This tries several
 * variants for one client and prints HTTP ok + a truncated raw body so we
 * can see which shape returns an organic/paid split.
 *
 * GET-only against Graph; token read from Vault and NEVER printed (redacted
 * in the echoed URLs). Safe on prod.
 *
 * Usage: pnpm tsx --env-file=.env.local scripts/probe-meta-breakdown-formats.ts [slug]
 */
import { createAdminClient } from "../src/lib/supabase/server";
import { getVaultSecret } from "../src/lib/etl/vault";
import { META_API_VERSION } from "../src/lib/meta-oauth";

const G = `https://graph.facebook.com/${META_API_VERSION}`;
const SLUG = process.argv[2] ?? "stl-sports-clinic";

// Scrub tokens from ANY string we print. Meta echoes the access_token inside
// paging.next/previous URLs in the response body, so redacting only the request
// URL leaks it — scrub the bodies too, and nuke any EAA… token-shaped substring.
const scrub = (s: string) =>
  s.replace(/access_token=[^&"\\]+/g, "access_token=REDACTED").replace(/EAA[A-Za-z0-9]{20,}/g, "TOKEN_REDACTED");

async function tryUrl(label: string, url: string) {
  console.log(`\n### ${label}`);
  console.log(scrub(url));
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json();
    console.log(`HTTP ${res.status}`);
    console.log(scrub(JSON.stringify(body)).slice(0, 1400));
  } catch (e) {
    console.log("fetch threw:", (e as Error).message);
  }
}

async function main() {
  const sb = createAdminClient();
  const { data: client } = await sb.from("clients").select("id, slug").eq("slug", SLUG).maybeSingle();
  if (!client) throw new Error(`no client ${SLUG}`);

  const { data: cred } = await sb
    .from("client_social_credentials")
    .select("access_token_secret_id, fb_page_id")
    .eq("client_id", client.id)
    .not("fb_page_id", "is", null)
    .maybeSingle();
  if (!cred?.fb_page_id || !cred.access_token_secret_id) throw new Error("no FB page connected");

  const token = await getVaultSecret(sb, cred.access_token_secret_id);
  const pid = cred.fb_page_id;
  const until = Math.floor(Date.now() / 1000);
  const since = until - 14 * 86_400;
  const t = `access_token=${token}`;

  // ── PAGE-level page_media_view ──────────────────────────────────────────
  await tryUrl(
    "A page_media_view · total_value + breakdown",
    `${G}/${pid}/insights?metric=page_media_view&metric_type=total_value&breakdown=is_from_ads&since=${since}&until=${until}&${t}`,
  );
  await tryUrl(
    "B page_media_view · period=day + total_value + breakdown",
    `${G}/${pid}/insights?metric=page_media_view&period=day&metric_type=total_value&breakdown=is_from_ads&since=${since}&until=${until}&${t}`,
  );
  await tryUrl(
    "C page_post_engagements · total_value + breakdown",
    `${G}/${pid}/insights?metric=page_post_engagements&metric_type=total_value&breakdown=is_from_ads&since=${since}&until=${until}&${t}`,
  );

  // ── POST-level fallback: pull one recent post, test post_media_view ──────
  const postsRes = await fetch(`${G}/${pid}/published_posts?limit=3&fields=id,created_time&${t}`, { cache: "no-store" });
  const postsBody = (await postsRes.json()) as any;
  const postId: string | undefined = postsBody?.data?.[0]?.id;
  console.log(`\n# recent post id present: ${Boolean(postId)} (posts http ${postsRes.status})`);
  if (postId) {
    // Does post-level ENGAGEMENT split by is_from_ads? If the response tags
    // entries with is_from_ads (even when paid=0 for this non-boosted post),
    // the breakdown is SUPPORTED → we can sum organic engagement per post.
    // If it returns plain values with no is_from_ads field, it is NOT.
    await tryUrl(
      "D post_activity_by_action_type · total_value + breakdown",
      `${G}/${postId}/insights?metric=post_activity_by_action_type&metric_type=total_value&breakdown=is_from_ads&${t}`,
    );
    await tryUrl(
      "E post_reactions_by_type_total · total_value + breakdown",
      `${G}/${postId}/insights?metric=post_reactions_by_type_total&metric_type=total_value&breakdown=is_from_ads&${t}`,
    );
    await tryUrl(
      "F post_clicks · total_value + breakdown",
      `${G}/${postId}/insights?metric=post_clicks&metric_type=total_value&breakdown=is_from_ads&${t}`,
    );
  }
  // Page-level engagement alternative that may support the breakdown.
  await tryUrl(
    "G page_actions_post_reactions_total · total_value + breakdown",
    `${G}/${pid}/insights?metric=page_actions_post_reactions_total&metric_type=total_value&breakdown=is_from_ads&since=${since}&until=${until}&${t}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
