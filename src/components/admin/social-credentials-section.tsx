/**
 * Per-client Social Credentials admin section — Meta (Facebook + Instagram via
 * one OAuth grant), YouTube, and TikTok each have their own connect block.
 * LinkedIn is shown as "coming soon" until its API approval lands.
 *
 * Server component: reads client_social_credentials directly and renders, per
 * platform, either:
 *   - Not connected → a "Connect …" button (links to /api/auth/<platform>/start
 *     which kicks off OAuth)
 *   - Connected     → which account/page is linked, plus a "Reconnect" link to
 *     swap accounts or re-grant scopes
 *
 * No write action lives here; the OAuth callback handles all DB writes.
 */
import { CheckCircle2, AlertCircle } from "lucide-react";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import { getVaultSecret } from "@/lib/etl/vault";
import { ProgressLink } from "@/components/progress-link";
import { META_PENDING_COOKIE } from "@/app/api/auth/meta/callback/route";
import { selectMetaPage, cancelMetaPicker } from "./social-picker-actions";
import { disconnectSocial } from "./social-disconnect-actions";
import { SubmitPrimary, SubmitLink } from "./submit-button";

// Lucide v1.16 (this repo's version) doesn't ship brand glyphs. Tiny
// inline SVGs so we don't pull in a logos package just for two icons.
function FacebookIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}
function InstagramIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
    </svg>
  );
}
function YoutubeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" />
    </svg>
  );
}
function TiktokIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
    </svg>
  );
}
function LinkedinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

type Props = {
  clientId: string;
  clientSlug: string;
  /**
   * Which surface is rendering this panel — drives where Meta's connect /
   * page-picker flow returns. "socials" sends the OAuth callback + picker
   * back to the Socials dashboard's connect modal; default "admin" keeps
   * the inline admin-page behavior (and is the only path for non-Varble
   * clients, whose Socials page isn't exposed yet).
   */
  returnTo?: "admin" | "socials";
};

type MetaCredsRow = {
  fb_page_id: string | null;
  fb_page_name: string | null;
  ig_user_id: string | null;
  ig_username: string | null;
  connected_at: string | null;
};

type YoutubeCredsRow = {
  youtube_channel_id: string | null;
  youtube_channel_title: string | null;
  youtube_channel_handle: string | null;
  youtube_channel_thumbnail: string | null;
  connected_at: string | null;
};

type TiktokCredsRow = {
  tiktok_open_id: string | null;
  tiktok_username: string | null;
  tiktok_display_name: string | null;
  tiktok_avatar_url: string | null;
  connected_at: string | null;
};

type LinkedinCredsRow = {
  linkedin_org_urn: string | null;
  linkedin_org_name: string | null;
  linkedin_vanity_name: string | null;
  linkedin_org_logo_url: string | null;
  connected_at: string | null;
};

type StagedPage = {
  id: string;
  name: string;
  ig_user_id: string | null;
  ig_username: string | null;
};

export async function SocialCredentialsSection({ clientId, clientSlug, returnTo = "admin" }: Props) {
  const supabase = createAdminClient();
  // Fetch all platforms' creds in one roundtrip — table is keyed by
  // (client_id, platform), so we filter in JS to avoid N queries.
  const { data: rows } = await supabase
    .from("client_social_credentials")
    .select(
      "platform, fb_page_id, fb_page_name, ig_user_id, ig_username, " +
        "youtube_channel_id, youtube_channel_title, youtube_channel_handle, youtube_channel_thumbnail, " +
        "tiktok_open_id, tiktok_username, tiktok_display_name, tiktok_avatar_url, " +
        "linkedin_org_urn, linkedin_org_name, linkedin_vanity_name, linkedin_org_logo_url, " +
        "connected_at",
    )
    .eq("client_id", clientId);

  type AnyRow = MetaCredsRow & YoutubeCredsRow & TiktokCredsRow & LinkedinCredsRow & { platform: string };
  const byPlatform = new Map<string, AnyRow>();
  for (const r of (rows ?? []) as unknown as AnyRow[]) byPlatform.set(r.platform, r);

  const meta     = (byPlatform.get("meta")     as MetaCredsRow     | undefined) ?? null;
  const youtube  = (byPlatform.get("youtube")  as YoutubeCredsRow  | undefined) ?? null;
  const tiktok   = (byPlatform.get("tiktok")   as TiktokCredsRow   | undefined) ?? null;

  const metaConnected     = !!meta?.fb_page_id;
  const youtubeConnected  = !!youtube?.youtube_channel_id;
  const tiktokConnected   = !!tiktok?.tiktok_open_id;

  const returnToSuffix    = returnTo === "socials" ? "&returnTo=socials" : "";
  const metaStartHref     = `/api/auth/meta/start?clientId=${encodeURIComponent(clientId)}${returnToSuffix}`;
  const youtubeStartHref  = `/api/auth/youtube/start?clientId=${encodeURIComponent(clientId)}${returnToSuffix}`;
  const tiktokStartHref   = `/api/auth/tiktok/start?clientId=${encodeURIComponent(clientId)}${returnToSuffix}`;

  // ── Picker state: did OAuth just finish and we have a pending choice? ──
  // The OAuth callback stages all the user's Pages in vault + drops the
  // secret_id into ps_meta_oauth_pending. If that cookie is present, we
  // render the picker INSTEAD of the connect/connected state — the admin
  // has to either pick a Page or cancel before the section returns to
  // its normal modes.
  const cookieStore = await cookies();
  const pendingSecretId = cookieStore.get(META_PENDING_COOKIE)?.value;
  let pendingPages: StagedPage[] | null = null;
  if (pendingSecretId) {
    try {
      const stagedJson = await getVaultSecret(supabase, pendingSecretId);
      const all = JSON.parse(stagedJson) as Array<StagedPage & { access_token: string }>;
      // Strip access_token before rendering — never expose it to the UI
      // layer even though this is a server component.
      pendingPages = all.map(({ id, name, ig_user_id, ig_username }) => ({
        id, name, ig_user_id, ig_username,
      }));
    } catch {
      // Cookie outlived the vault secret (expired / cleaned up). Fall
      // through to the normal not-connected/connected view; the cookie
      // will be ignored and eventually pruned by maxAge.
      pendingPages = null;
    }
  }

  return (
    <section className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-7 flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Social Accounts
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Connect this client&apos;s social accounts so the Socials dashboard can
          ingest organic post analytics. Meta covers both Facebook Page and the
          linked Instagram Business Account in one grant.
        </p>
      </div>

      {/* ── Meta block ─────────────────────────────────────────────────── */}
      <PlatformBlock label="Facebook + Instagram (Meta)">
        {pendingPages ? (
          <MetaPickerState
            pages={pendingPages}
            clientId={clientId}
            clientSlug={clientSlug}
            returnTo={returnTo}
          />
        ) : metaConnected ? (
          <ConnectedMetaState
            creds={meta!}
            reconnectHref={metaStartHref}
            clientId={clientId}
            clientSlug={clientSlug}
          />
        ) : (
          <NotConnectedMetaState connectHref={metaStartHref} />
        )}
      </PlatformBlock>

      {/* ── YouTube block ──────────────────────────────────────────────── */}
      <PlatformBlock label="YouTube">
        {youtubeConnected ? (
          <ConnectedYoutubeState
            creds={youtube!}
            reconnectHref={youtubeStartHref}
            clientId={clientId}
            clientSlug={clientSlug}
          />
        ) : (
          <NotConnectedYoutubeState connectHref={youtubeStartHref} />
        )}
      </PlatformBlock>

      {/* ── TikTok block ───────────────────────────────────────────────── */}
      <PlatformBlock label="TikTok">
        {tiktokConnected ? (
          <ConnectedTiktokState
            creds={tiktok!}
            reconnectHref={tiktokStartHref}
            clientId={clientId}
            clientSlug={clientSlug}
          />
        ) : (
          <NotConnectedTiktokState connectHref={tiktokStartHref} />
        )}
      </PlatformBlock>

      {/* ── LinkedIn block — inactive, coming soon ─────────────────────── */}
      <PlatformBlock label="LinkedIn">
        <ComingSoonLinkedinState />
      </PlatformBlock>
    </section>
  );
}

function PlatformBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-tertiary)] font-medium">
        {label}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function MetaPickerState({
  pages,
  clientId,
  clientSlug,
  returnTo,
}: {
  pages: StagedPage[];
  clientId: string;
  clientSlug: string;
  returnTo: "admin" | "socials";
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[var(--ps-yellow)]/10 border border-[var(--ps-yellow)]/40 rounded-md px-4 py-3 text-[12px] text-[var(--text-secondary)]">
        <strong className="text-[var(--text-primary)]">Pick which Page to link</strong>{" "}
        — Meta gave us access to {pages.length} Page{pages.length === 1 ? "" : "s"} you
        manage. Choose the one that corresponds to <strong>this client</strong>.
      </div>

      <div className="flex flex-col gap-2">
        {pages.map((p) => {
          const hasIg = !!p.ig_user_id;
          return (
            <form
              key={p.id}
              action={selectMetaPage}
              className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-4 flex items-center gap-3 flex-wrap"
            >
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="clientSlug" value={clientSlug} />
              <input type="hidden" name="fbPageId" value={p.id} />
              <input type="hidden" name="returnTo" value={returnTo} />

              <span style={{ color: "#1877F2" }} className="shrink-0">
                <FacebookIcon size={18} />
              </span>

              <div className="flex-1 min-w-[160px]">
                <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {p.name}
                </div>
                <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5 flex items-center gap-1.5">
                  <span style={{ color: "#E1306C" }}>
                    <InstagramIcon size={11} />
                  </span>
                  {hasIg ? (
                    <span>@{p.ig_username ?? p.ig_user_id}</span>
                  ) : (
                    <span>No Instagram linked</span>
                  )}
                </div>
              </div>

              <SubmitPrimary pendingLabel="Linking…">Use this Page</SubmitPrimary>
            </form>
          );
        })}
      </div>

      {/* Escape hatch — discard the staged pages without picking. */}
      <form action={cancelMetaPicker} className="flex justify-end">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="clientSlug" value={clientSlug} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <SubmitLink pendingLabel="Cancelling…" tone="danger">
          Cancel — none of these
        </SubmitLink>
      </form>
    </div>
  );
}

function NotConnectedMetaState({ connectHref }: { connectHref: string }) {
  return (
    <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-5 flex items-center gap-4 flex-wrap">
      <div className="flex items-center gap-2.5">
        <span style={{ color: "#1877F2" }}><FacebookIcon size={18} /></span>
        <span style={{ color: "#E1306C" }}><InstagramIcon size={18} /></span>
      </div>
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-medium text-[var(--text-primary)]">
          Not connected
        </div>
        <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
          You&apos;ll be redirected to Facebook to pick which Page to authorize.
          The connected Instagram Business Account is linked automatically.
        </div>
      </div>
      <a
        href={connectHref}
        className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2.5 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)] transition-colors"
      >
        Connect Facebook + Instagram
      </a>
    </div>
  );
}

/**
 * Shared Disconnect form. Renders a small "Disconnect" link styled as a
 * destructive secondary action. Tucked next to each platform's Reconnect
 * link in the connected state.
 *
 * On submit:
 *   1. Server action runs `disconnectSocial({ platform })` — deletes the
 *      vault secret + credential row + revalidates the admin page.
 *   2. Next render the platform shows as not-connected.
 *
 * IMPORTANT: this does NOT revoke the OAuth grant on the platform side
 * (TikTok / Google / Meta). The user still has the app authorized in
 * their platform's "Connected apps" settings — that's intentional, we
 * shouldn't silently make decisions for them on third-party platforms.
 *
 * The switching-accounts guidance in each NotConnected*State explains
 * what to do when the goal is "swap to a different account" rather
 * than "fully sever the connection".
 */
function DisconnectForm({
  clientId,
  clientSlug,
  platform,
}: {
  clientId: string;
  clientSlug: string;
  platform: "meta" | "youtube" | "tiktok" | "linkedin";
}) {
  return (
    <form action={disconnectSocial} className="inline-flex">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="clientSlug" value={clientSlug} />
      <input type="hidden" name="platform" value={platform} />
      <SubmitLink tone="danger" pendingLabel="Disconnecting…">
        Disconnect
      </SubmitLink>
    </form>
  );
}

function ConnectedMetaState({
  creds,
  reconnectHref,
  clientId,
  clientSlug,
}: {
  creds: MetaCredsRow;
  reconnectHref: string;
  clientId: string;
  clientSlug: string;
}) {
  const hasIg = !!creds.ig_user_id;
  return (
    <div className="flex flex-col gap-3">
      {/* Facebook row */}
      <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-4 flex items-center gap-3 flex-wrap">
        <span style={{ color: "#1877F2" }} className="shrink-0"><FacebookIcon size={18} /></span>
        <div className="flex-1 min-w-[160px]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Facebook Page
          </div>
          <div className="text-sm text-[var(--text-primary)] font-medium truncate">
            {creds.fb_page_name ?? creds.fb_page_id}
          </div>
        </div>
        <CheckCircle2 size={14} className="text-[var(--positive)]" />
      </div>

      {/* Instagram row */}
      <div
        className={
          "border rounded-md p-4 flex items-center gap-3 flex-wrap " +
          (hasIg
            ? "bg-[var(--surface-2)]/40 border-[var(--surface-3)]/40"
            : "bg-[var(--surface-2)]/20 border-[var(--surface-3)]/30")
        }
      >
        <span style={{ color: "#E1306C" }} className="shrink-0"><InstagramIcon size={18} /></span>
        <div className="flex-1 min-w-[160px]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            Instagram Business Account
          </div>
          {hasIg ? (
            <div className="text-sm text-[var(--text-primary)] font-medium truncate">
              @{creds.ig_username ?? creds.ig_user_id}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-secondary)] flex items-center gap-1.5">
              <AlertCircle size={12} className="text-[var(--text-tertiary)]" />
              No Instagram linked to this Page
            </div>
          )}
        </div>
        {hasIg && <CheckCircle2 size={14} className="text-[var(--positive)]" />}
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        {!hasIg && (
          <span className="text-[11px] text-[var(--text-tertiary)] mr-auto">
            To enable IG, link a Business or Creator IG account to this Page in
            Meta Business Manager, then click Reconnect.
          </span>
        )}
        <ProgressLink
          href={reconnectHref}
          className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
        >
          Reconnect / switch Page
        </ProgressLink>
        <span className="text-[var(--surface-3)]/60">·</span>
        <DisconnectForm clientId={clientId} clientSlug={clientSlug} platform="meta" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube — connect / connected states. Google's OAuth dialog handles
// the multi-channel picker itself (we send prompt=select_account), so
// switching accounts just works — no logout hint needed.

function NotConnectedYoutubeState({ connectHref }: { connectHref: string }) {
  return (
    <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-5 flex items-center gap-4 flex-wrap">
      <span style={{ color: "#FF0000" }} className="shrink-0">
        <YoutubeIcon size={20} />
      </span>
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-medium text-[var(--text-primary)]">Not connected</div>
        <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
          You&apos;ll be redirected to Google to pick which YouTube channel to
          authorize. Brand Account channels show up alongside personal ones in
          the picker.
        </div>
      </div>
      <a
        href={connectHref}
        className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2.5 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)] transition-colors"
      >
        Connect YouTube
      </a>
    </div>
  );
}

function ConnectedYoutubeState({
  creds,
  reconnectHref,
  clientId,
  clientSlug,
}: {
  creds: YoutubeCredsRow;
  reconnectHref: string;
  clientId: string;
  clientSlug: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-4 flex items-center gap-3 flex-wrap">
        <span style={{ color: "#FF0000" }} className="shrink-0">
          <YoutubeIcon size={18} />
        </span>
        <div className="flex-1 min-w-[160px]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            YouTube Channel
          </div>
          <div className="text-sm text-[var(--text-primary)] font-medium truncate">
            {creds.youtube_channel_title ?? creds.youtube_channel_id}
            {creds.youtube_channel_handle && (
              <span className="text-[var(--text-tertiary)] font-normal ml-2">
                {/* YouTube stores handles with a leading "@" already — strip
                    any leading "@" so we render exactly one. */}
                @{creds.youtube_channel_handle.replace(/^@+/, "")}
              </span>
            )}
          </div>
        </div>
        <CheckCircle2 size={14} className="text-[var(--positive)]" />
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <ProgressLink
          href={reconnectHref}
          className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
        >
          Reconnect / switch channel
        </ProgressLink>
        <span className="text-[var(--surface-3)]/60">·</span>
        <DisconnectForm clientId={clientId} clientSlug={clientSlug} platform="youtube" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TikTok

function NotConnectedTiktokState({ connectHref }: { connectHref: string }) {
  return (
    <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-5 flex items-center gap-4 flex-wrap">
      <span style={{ color: "#fe2c55" }} className="shrink-0">
        <TiktokIcon size={20} />
      </span>
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-medium text-[var(--text-primary)]">Not connected</div>
        <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
          You&apos;ll be redirected to TikTok. Personal, Creator, and Business
          accounts all work — Login Kit reads public analytics from any account type.
        </div>
      </div>
      <a
        href={connectHref}
        className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2.5 rounded-md bg-[var(--ps-yellow)] text-[var(--text-on-yellow)] hover:bg-[var(--ps-yellow-soft)] transition-colors"
      >
        Connect TikTok
      </a>
    </div>
  );
}

function ConnectedTiktokState({
  creds,
  reconnectHref,
  clientId,
  clientSlug,
}: {
  creds: TiktokCredsRow;
  reconnectHref: string;
  clientId: string;
  clientSlug: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-[var(--surface-2)]/40 border border-[var(--surface-3)]/40 rounded-md p-4 flex items-center gap-3 flex-wrap">
        <span style={{ color: "#fe2c55" }} className="shrink-0">
          <TiktokIcon size={18} />
        </span>
        <div className="flex-1 min-w-[160px]">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
            TikTok Account
          </div>
          <div className="text-sm text-[var(--text-primary)] font-medium truncate">
            {creds.tiktok_display_name ?? creds.tiktok_username ?? creds.tiktok_open_id}
            {creds.tiktok_username && (
              <span className="text-[var(--text-tertiary)] font-normal ml-2">
                @{creds.tiktok_username}
              </span>
            )}
          </div>
        </div>
        <CheckCircle2 size={14} className="text-[var(--positive)]" />
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <ProgressLink
          href={reconnectHref}
          className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
        >
          Reconnect / switch account
        </ProgressLink>
        <span className="text-[var(--surface-3)]/60">·</span>
        <DisconnectForm clientId={clientId} clientSlug={clientSlug} platform="tiktok" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LinkedIn — coming soon. The connect flow exists but LinkedIn's Community
// Management API approval (Microsoft review) isn't through yet, so we render
// an inactive "Coming soon" block instead of a live connect button.

function ComingSoonLinkedinState() {
  return (
    <div className="bg-[var(--surface-2)]/20 border border-[var(--surface-3)]/30 rounded-md p-5 flex items-center gap-4 flex-wrap opacity-80">
      <span style={{ color: "#0A66C2" }} className="shrink-0 opacity-60">
        <LinkedinIcon size={20} />
      </span>
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-medium text-[var(--text-secondary)]">LinkedIn</div>
        <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
          Company Page analytics are on the way — we&apos;re finishing LinkedIn&apos;s
          API approval. You&apos;ll be able to connect this soon.
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-md bg-[var(--surface-3)]/40 text-[var(--text-tertiary)] cursor-not-allowed select-none">
        Coming soon
      </span>
    </div>
  );
}
