/**
 * Edge-safe wipe of a client's stored social data for one or more platforms.
 *
 * Deliberately split out of the heavyweight `social.ts` ETL: the OAuth callbacks
 * that call this on a (re)connect run on the EDGE runtime, while social.ts is
 * `server-only` and drags in the whole fetch/transform graph. This module
 * touches nothing but the Supabase client it's handed, so it's cheap to pull
 * into an edge bundle (the `SocialPlatform` import is type-only → erased).
 *
 * Used when a client (re)connects a DIFFERENT account so the old account's rows
 * don't bleed into the new one's charts — the worst offender being social_posts,
 * keyed on (client_id, platform, post_id): a new account's posts have different
 * ids, so an upsert never overwrites the old account's posts and they'd linger
 * forever. We delete from all three social tables for the named series only
 * (never other platforms, never other clients). Idempotent; safe to call when
 * there's nothing to delete. The credential row itself is NOT touched — the
 * caller has just upserted it.
 */
import type { createAdminClient } from "@/lib/supabase/server";
import type { SocialPlatform } from "@/lib/etl/social";

type Supa = ReturnType<typeof createAdminClient>;

export async function resetSocialData(
  supabase: Supa,
  clientId: string,
  platforms: SocialPlatform[],
): Promise<void> {
  if (platforms.length === 0) return;
  const del = (table: string) =>
    supabase.from(table).delete().eq("client_id", clientId).in("platform", platforms);
  const [m, p, j] = await Promise.all([
    del("social_daily_metrics"),
    del("social_posts"),
    del("social_backfill_jobs"),
  ]);
  const err = m.error ?? p.error ?? j.error;
  if (err) {
    throw new Error(`resetSocialData failed for [${platforms.join(", ")}]: ${err.message}`);
  }
}
