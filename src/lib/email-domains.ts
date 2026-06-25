/**
 * Public mailbox providers that must NOT be usable as a client_domains access
 * rule. A domain rule grants tenant access to EVERYONE on that domain, so a rule
 * like "gmail.com" would let any attacker with a free Gmail into the tenant.
 * Personal-mailbox users belong in the per-email allowlist (client_allowed_emails).
 *
 * Shared by both write paths — components/admin/access-actions.ts (Access form)
 * and app/clients/new/actions.ts (new-client flow) — and mirrored by a DB trigger
 * (migration 046) so a direct service-role insert can't bypass it either.
 *
 * Kept in a plain module (NOT a "use server" file) so it can export a sync helper.
 */
export const PUBLIC_EMAIL_PROVIDERS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me", "aol.com", "gmx.com", "gmx.net",
  "mail.com", "zoho.com", "yandex.com", "hey.com", "fastmail.com",
]);

/** True when `domain` is a known public email provider (case-insensitive). */
export function isPublicEmailProvider(domain: string): boolean {
  return PUBLIC_EMAIL_PROVIDERS.has(domain.trim().toLowerCase());
}
