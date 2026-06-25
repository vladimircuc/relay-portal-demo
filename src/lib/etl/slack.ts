/**
 * Slack notifiers. Two entry points, both gated by SLACK_WEBHOOK_URL:
 *
 *   notifyEtlFailure — fires from withEtlRun() whenever an ETL pull (cron or
 *     manual) THROWS. Detailed, actionable: the error + an admin-page button.
 *
 *   notifyEtlDigest — end-of-cron summary, per client × per platform (Meta ads,
 *     GHL leads, Facebook, Instagram, YouTube, TikTok) ✅ / ⚠️ 0-rows / 🚨 error,
 *     so a platform that fails SILENTLY (its fetcher swallows the error and the
 *     run still "succeeds") is still surfaced. By DEFAULT it posts ONLY when
 *     there's a problem (SLACK_DAILY_DIGEST="failures"); set it to "always" for a
 *     daily green heartbeat too. notifyEtlFailure is the per-incident detail.
 *
 * Env vars:
 *   SLACK_WEBHOOK_URL    Incoming-webhook URL. Without it both no-op (failures
 *                        still land in etl_runs + Vercel logs; Slack is just an
 *                        additional alert channel).
 *   SLACK_DAILY_DIGEST   Digest verbosity: "failures" (default) posts the digest
 *                        ONLY when something needs attention (an error or a
 *                        suspicious 0-row pull) — Slack stays quiet on a healthy
 *                        day. Set "always" to also get the green "everything
 *                        pulled" heartbeat every run.
 *   NEXT_PUBLIC_APP_URL  Base URL like "https://portal.posted-social.com".
 *                        Used to construct a clickable link to the
 *                        admin page from the Slack message. Falls back
 *                        to VERCEL_URL, then to no link.
 *
 * Message style:
 *   - username = "Relay ETL" so it doesn't get visually mistaken
 *     for other apps posting in the same channel (the user mentioned
 *     they previously used Slack for a Google Sheets thing).
 *   - icon_emoji = :rotating_light:
 *   - Block kit: red-attention header + a code block with the actual
 *     error + an "Open admin page" button. Easy to scan in a busy feed.
 *
 * Safety: any error from the Slack POST is swallowed. The webhook is
 * a side-channel notification; we never want a Slack outage (or a
 * misconfigured URL) to mask the actual ETL failure that's already
 * being logged to etl_runs.
 */

export type SlackFailureContext = {
  clientId: string;
  /** Used as etl_runs.source: 'meta_daily' | 'meta_backfill' | 'ghl_full' */
  source: string;
  message: string;
  /** Optional client slug for a more human header. */
  clientSlug?: string;
};

export async function notifyEtlFailure(ctx: SlackFailureContext): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  const who = ctx.clientSlug ?? ctx.clientId;
  const baseUrl = appBaseUrl();
  const adminUrl = ctx.clientSlug && baseUrl
    ? `${baseUrl}/${ctx.clientSlug}/admin`
    : null;

  // Trim — Slack message size is capped (~40KB) and pasting a giant
  // stack trace is rarely useful. The full error is in etl_runs.
  const trimmed = ctx.message.length > 600
    ? `${ctx.message.slice(0, 600)}\n…(truncated)`
    : ctx.message;

  // Block-kit payload. Falls back to a plain text rendering if the
  // workspace's Slack client somehow can't render blocks.
  const blocks: unknown[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚨 ETL failed for ${who}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Source*\n\`${ctx.source}\`` },
        { type: "mrkdwn", text: `*Client*\n${who}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Error*\n\`\`\`${trimmed}\`\`\``,
      },
    },
  ];

  if (adminUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open admin page", emoji: true },
          url: adminUrl,
        },
      ],
    });
  }

  const body = {
    username: "Relay ETL",
    icon_emoji: ":rotating_light:",
    text: `ETL ${ctx.source} failed for ${who}: ${trimmed.slice(0, 200)}`, // plain-text fallback
    blocks,
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Intentionally swallow — see file docstring.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily digest

/** Per-platform pull outcome for the digest. `ok` = pulled rows>0; `empty` =
 *  ran but wrote 0 rows (suspicious for an active connected account — often a
 *  fetcher that swallowed a bad HTTP response); `error` = the pull threw. */
export type DigestCheckStatus = "ok" | "empty" | "error";

export type DigestPlatform = {
  /** Human label, e.g. "Meta ads", "Leads", "Facebook". */
  label: string;
  status: DigestCheckStatus;
  /** Present when status === "error". */
  error?: string;
};

export type DigestClient = {
  slug: string;
  /** Only the platforms this client is expected to have (connected ones for
   *  social; ads + leads always). Skipped/not-connected platforms are omitted. */
  platforms: DigestPlatform[];
};

const STATUS_ICON: Record<DigestCheckStatus, string> = {
  ok: "✅",
  empty: "⚠️",
  error: "🚨",
};

/**
 * Post the once-a-day pull digest (see file docstring). One Slack message: a
 * health header, per-client chip lines, and — when not all-green — a capped
 * list of the specific issues. Best-effort: any POST error is swallowed so a
 * Slack hiccup never affects the cron's own outcome.
 */
export async function notifyEtlDigest(clients: DigestClient[]): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url || clients.length === 0) return;

  // Collect everything that isn't a clean success across all clients.
  const issues: Array<{ slug: string; label: string; status: DigestCheckStatus; error?: string }> = [];
  for (const c of clients) {
    for (const p of c.platforms) {
      if (p.status !== "ok") issues.push({ slug: c.slug, label: p.label, status: p.status, error: p.error });
    }
  }
  const healthy = issues.length === 0;

  // Default is "failures" — only post the digest when something needs attention
  // (an error or a suspicious 0-row pull); the all-green daily heartbeat is muted
  // so Slack only lights up on a problem. Set SLACK_DAILY_DIGEST=always to get the
  // green "everything pulled" heartbeat back.
  const mode = (process.env.SLACK_DAILY_DIGEST ?? "failures").toLowerCase();
  if (mode !== "always" && healthy) return;

  const clientsWithIssues = new Set(issues.map((i) => i.slug)).size;
  const headerText = healthy
    ? `✅ Daily pull — all ${clients.length} client${clients.length === 1 ? "" : "s"} healthy`
    : `🚨 Daily pull — ${issues.length} issue${issues.length === 1 ? "" : "s"} across ` +
      `${clientsWithIssues} client${clientsWithIssues === 1 ? "" : "s"}`;

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: headerText, emoji: true } },
  ];

  // Per-client chip lines, packed under Slack's ~3000-char per-block limit
  // (50 clients would overflow a single section block).
  const lines = clients.map((c) => {
    const chips = c.platforms
      .map((p) => `${STATUS_ICON[p.status]} ${p.label}`)
      .join("  ·  ");
    return `*${c.slug}* — ${chips || "_nothing connected_"}`;
  });
  for (const chunk of packLines(lines, 2800)) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
  }

  // Issue detail — errors first, capped so a bad day doesn't post a wall of
  // text (the full error of each is also in its own notifyEtlFailure ping).
  if (!healthy) {
    const CAP = 15;
    const ordered = [...issues].sort(
      (a, b) => (a.status === "error" ? 0 : 1) - (b.status === "error" ? 0 : 1),
    );
    const detail = ordered.slice(0, CAP).map((i) => {
      if (i.status === "error") {
        const msg = (i.error ?? "unknown error").replace(/\s+/g, " ").slice(0, 160);
        return `${STATUS_ICON.error} *${i.slug}* / ${i.label}: ${msg}`;
      }
      return `${STATUS_ICON.empty} *${i.slug}* / ${i.label}: wrote 0 rows`;
    });
    if (issues.length > CAP) detail.push(`…and ${issues.length - CAP} more`);
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: detail.join("\n") } });
  }

  const body = {
    username: "Relay ETL",
    icon_emoji: healthy ? ":white_check_mark:" : ":rotating_light:",
    text: headerText, // plain-text fallback
    blocks,
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Intentionally swallow — see file docstring.
  }
}

/** Pack lines into chunks each ≤ maxChars (newline-joined), so a long client
 *  list spans multiple section blocks instead of overflowing one. */
function packLines(lines: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    if (cur && cur.length + 1 + line.length > maxChars) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Resolve the public base URL for building clickable Slack links. */
function appBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}
