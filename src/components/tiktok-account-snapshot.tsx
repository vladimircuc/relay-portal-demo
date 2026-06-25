/**
 * Live TikTok account snapshot — a real-time read straight from the TikTok API
 * (NOT the stored ETL tables), rendered on the /socials Advanced view.
 *
 * It exists to make every granted TikTok scope visibly "used" in one place,
 * for the OAuth review demo + operator verification:
 *
 *   - user.info.basic   → avatar + display name
 *   - user.info.profile → @username, bio, profile link, verified badge
 *   - user.info.stats   → follower / following / likes / video counts
 *   - video.list        → the 6 most-recent videos, each with its own
 *                          view / like / comment / share counts
 *
 * Data comes from `fetchTiktokSnapshot()` (lib/tiktok-data.ts), passed in by
 * the server page. Presentational only — no client JS, no data fetching here.
 */
import Image from "next/image";
import { BadgeCheck, ExternalLink, Eye, Heart, MessageCircle, Share2, Users, UserPlus, ThumbsUp, Film, type LucideIcon } from "lucide-react";
import type { TiktokSnapshotResult } from "@/lib/tiktok-data";

const TIKTOK = "#25F4EE";

const fmtCompact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
  : Math.abs(n) >= 1_000 ? (n / 1_000).toFixed(1) + "K"
  : String(n);
const fmtFull = (n: number) => n.toLocaleString("en-US");

const fmtDuration = (s: number) => {
  if (!s || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};
const fmtVideoDate = (unixSeconds: number) =>
  unixSeconds > 0
    ? new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[var(--surface-3)]/40 bg-[var(--surface-2)]/30 px-4 py-3.5 flex flex-col gap-1">
      <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg"
        style={{ background: `${TIKTOK}1f`, color: TIKTOK }}>
        <Icon size={15} strokeWidth={2.25} />
      </span>
      <span className="mt-1 text-[22px] font-bold tabular-nums leading-none text-[var(--text-primary)]" title={fmtFull(value)}>
        {fmtCompact(value)}
      </span>
      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">{label}</span>
      <Icon aria-hidden size={64} className="pointer-events-none absolute -right-3 -bottom-3 opacity-[0.05]" />
    </div>
  );
}

function VideoStat({ icon: Icon, value }: { icon: LucideIcon; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-[var(--text-secondary)]">
      <Icon size={12} strokeWidth={2.25} style={{ color: TIKTOK }} /> {fmtCompact(value)}
    </span>
  );
}

export function TiktokAccountSnapshot({ snapshot }: { snapshot: TiktokSnapshotResult | null }) {
  // Not connected / not fetched → render nothing.
  if (!snapshot) return null;

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-4 sm:p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Image src="/brand/social/tiktok.png" alt="TikTok" width={20} height={20} className="object-contain" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">TikTok account</h2>
            <span className="inline-flex items-center gap-1.5 h-5 px-2 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{ background: `${TIKTOK}1f`, color: TIKTOK }}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: TIKTOK }} /> Live
            </span>
          </div>
          <span className="text-[12px] text-[var(--text-tertiary)]">
            Pulled in real time from the TikTok API — profile, audience stats, and recent video performance.
          </span>
        </div>
      </div>

      {snapshot.ok ? (
        <SnapshotBody snapshot={snapshot} />
      ) : (
        <div className="rounded-lg border border-[var(--surface-3)]/50 bg-[var(--surface-2)]/40 px-4 py-3 text-[12.5px] text-[var(--text-tertiary)]">
          Couldn&apos;t load live TikTok data right now. {snapshot.error}
        </div>
      )}
    </section>
  );
}

function SnapshotBody({ snapshot }: { snapshot: Extract<TiktokSnapshotResult, { ok: true }> }) {
  const { user, videos } = snapshot;
  return (
    <>
      {/* Profile — user.info.basic + user.info.profile */}
      <div className="flex items-start gap-4">
        {user.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote TikTok CDN avatar (arbitrary, expiring URL)
          <img src={user.avatar_url} alt={user.display_name}
            className="h-16 w-16 rounded-full object-cover border border-[var(--surface-3)]/60 shrink-0" />
        ) : (
          <span className="h-16 w-16 rounded-full bg-[var(--surface-3)]/50 shrink-0" />
        )}
        <div className="min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">{user.display_name || "TikTok user"}</span>
            {user.is_verified && <BadgeCheck size={16} strokeWidth={2.5} style={{ color: TIKTOK }} aria-label="Verified" />}
          </div>
          {user.username && (
            user.profile_deep_link ? (
              <a href={user.profile_deep_link} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 w-fit text-[12.5px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
                @{user.username} <ExternalLink size={12} />
              </a>
            ) : (
              <span className="text-[12.5px] text-[var(--text-secondary)]">@{user.username}</span>
            )
          )}
          {user.bio_description && (
            <p className="text-[12.5px] leading-snug text-[var(--text-tertiary)] line-clamp-2 max-w-prose">{user.bio_description}</p>
          )}
        </div>
      </div>

      {/* Audience stats — user.info.stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard icon={Users} label="Followers" value={user.follower_count} />
        <StatCard icon={UserPlus} label="Following" value={user.following_count} />
        <StatCard icon={ThumbsUp} label="Likes" value={user.likes_count} />
        <StatCard icon={Film} label="Videos" value={user.video_count} />
      </div>

      {/* Recent videos — video.list */}
      <div className="flex flex-col gap-3">
        <h3 className="text-[13px] font-semibold text-[var(--text-secondary)]">Recent videos</h3>
        {videos.length === 0 ? (
          <div className="min-h-[120px] flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
            No public videos returned for this account.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {videos.map((v) => (
              <a key={v.id} href={v.share_url || "#"} target="_blank" rel="noreferrer"
                className="group rounded-xl border border-[var(--surface-3)]/40 bg-[var(--surface-2)]/30 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--surface-3)] hover:shadow-xl hover:shadow-black/30">
                <div className="relative aspect-[4/5] bg-[var(--surface-3)]/40 overflow-hidden">
                  {v.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote TikTok CDN cover (arbitrary, expiring URL)
                    <img src={v.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
                  ) : (
                    <span aria-hidden className="absolute inset-0 flex items-center justify-center opacity-30">
                      <Film size={40} style={{ color: TIKTOK }} />
                    </span>
                  )}
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/55 to-transparent" />
                  {v.duration > 0 && (
                    <span className="absolute right-1.5 bottom-1.5 inline-flex items-center h-5 px-1.5 rounded bg-black/60 backdrop-blur-sm text-[10px] font-semibold text-white tabular-nums">
                      {fmtDuration(v.duration)}
                    </span>
                  )}
                </div>
                <div className="px-3 py-2.5 flex flex-col gap-1.5">
                  <p className="line-clamp-2 h-8 text-[12px] leading-snug text-[var(--text-primary)]">{v.title || "Untitled video"}</p>
                  {v.create_time > 0 && (
                    <span className="text-[10.5px] text-[var(--text-tertiary)] tabular-nums">{fmtVideoDate(v.create_time)}</span>
                  )}
                  <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
                    <VideoStat icon={Eye} value={v.view_count} />
                    <VideoStat icon={Heart} value={v.like_count} />
                    <VideoStat icon={MessageCircle} value={v.comment_count} />
                    <VideoStat icon={Share2} value={v.share_count} />
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
