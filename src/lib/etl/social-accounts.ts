/**
 * Account-scoping helpers shared by the social ETL (write) and the read layer.
 *
 * Background (migration 028): social_daily_metrics / social_posts now carry an
 * `account_id` = the platform's stable id of the account that produced the row
 * (fb_page_id / ig_user_id / youtube_channel_id / tiktok_open_id).
 * client_social_credentials is the "currently connected account" pointer. The
 * daily cron and every dashboard read scope to the ACTIVE account_id so a
 * different account's rows stay retained but dormant — reconnecting a new
 * account never deletes the old one's history.
 *
 * Type-only imports here (erased at build), so this stays a tiny module the
 * read layer can pull in without dragging the heavyweight ETL with it.
 */
import "server-only";
import type { createAdminClient } from "@/lib/supabase/server";
import type { SocialPlatform } from "@/lib/etl/social";

type Supa = ReturnType<typeof createAdminClient>;

/** Sentinel account_id for rows we can't tie to a connected account (a
 *  disconnected platform, or pre-028 data with no matching credential). Mirrors
 *  the migration-028 backfill fallback. Such rows are dormant — no active
 *  credential ever resolves to 'unknown', so reads skip them. */
export const UNKNOWN_ACCOUNT = "unknown";

/**
 * The account_id each connected platform's history is keyed by, read from the
 * client's CURRENT credentials — the "active account" pointer. Only these
 * (platform → account_id) pairs are pulled daily + shown in the dashboard;
 * rows stored under any other account_id are retained but dormant.
 *
 *   meta_facebook → fb_page_id        meta_instagram → ig_user_id
 *   youtube       → youtube_channel_id tiktok         → tiktok_open_id
 *
 * (LinkedIn is inactive — no ETL — so it needs no scoping and is omitted.)
 */
export async function activeAccountIds(
  supabase: Supa,
  clientId: string,
): Promise<Map<SocialPlatform, string>> {
  const { data } = await supabase
    .from("client_social_credentials")
    .select("platform, fb_page_id, ig_user_id, youtube_channel_id, tiktok_open_id")
    .eq("client_id", clientId);
  const out = new Map<SocialPlatform, string>();
  for (const row of (data ?? []) as Array<{
    platform: string;
    fb_page_id: string | null;
    ig_user_id: string | null;
    youtube_channel_id: string | null;
    tiktok_open_id: string | null;
  }>) {
    if (row.platform === "meta") {
      if (row.fb_page_id) out.set("meta_facebook", row.fb_page_id);
      if (row.ig_user_id) out.set("meta_instagram", row.ig_user_id);
    } else if (row.platform === "youtube") {
      if (row.youtube_channel_id) out.set("youtube", row.youtube_channel_id);
    } else if (row.platform === "tiktok") {
      if (row.tiktok_open_id) out.set("tiktok", row.tiktok_open_id);
    }
  }
  return out;
}

/**
 * PostgREST `.or()` argument that scopes a multi-platform read of
 * social_daily_metrics / social_posts to ONLY the active (platform, account_id)
 * pairs. It AND-combines with the query's other filters (client_id, day range),
 * yielding `… AND (this OR-group)`. Values are double-quoted so ids containing
 * PostgREST-reserved characters (`.`, `,`, `(`, `)`, `-`, …) are taken
 * literally. Returns null when nothing is connected — callers should then
 * short-circuit to an empty result rather than run an unscoped query.
 */
export function activeAccountOrFilter(active: Map<SocialPlatform, string>): string | null {
  const clauses: string[] = [];
  for (const [platform, accountId] of active) {
    const safe = accountId.replace(/"/g, '""');
    clauses.push(`and(platform.eq.${platform},account_id.eq."${safe}")`);
  }
  return clauses.length > 0 ? clauses.join(",") : null;
}
