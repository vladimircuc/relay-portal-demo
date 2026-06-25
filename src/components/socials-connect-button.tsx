"use client";

/**
 * Header "Connect Platform" control for the Socials page. In the live product
 * this opens the OAuth connect panel; in the demo the accounts are pre-connected
 * to synthetic data, so the button opens a "how connecting works" explainer
 * (tenant-bound OAuth, read-only scopes, encrypted token vault) instead of
 * running a real OAuth flow or exposing the disconnect controls.
 */
import { Plus, Link2 } from "lucide-react";
import { HowItWorks, type ExplainerContent } from "@/components/how-it-works";

// Kept for import compatibility with the empty-state CTA; harmless in the demo.
export const OPEN_SOCIALS_CONNECT_EVENT = "ps:open-socials-connect";
export const CLOSE_SOCIALS_CONNECT_EVENT = "ps:close-socials-connect";

const CONNECT_EXPLAINER: ExplainerContent = {
  title: "Connecting platforms, in production",
  Icon: Link2,
  intro:
    "Each social account is linked through that platform's OAuth — Facebook Business Login, Google, TikTok Login Kit, LinkedIn. In this demo the accounts are pre-connected to synthetic data, so this explains the real flow.",
  steps: [
    { title: "Tenant-bound OAuth", body: "/api/auth/<platform>/start signs this client's id into the OAuth state with an HMAC keyed by a server-only secret. The callback verifies it in constant time and derives the client from the verified state — so a forged or replayed callback can't repoint a grant at another tenant. TikTok adds PKCE." },
    { title: "Read-only scopes", body: "Relay requests only read-analytics scopes — it never posts, messages, or changes anything. Meta links a Facebook Page plus its connected Instagram in one grant; YouTube comes through Google; TikTok through the Display API." },
    { title: "Platform app review", body: "Going live meant passing each platform's review — Meta App Review, the TikTok audit, Google's OAuth verification, LinkedIn's Microsoft vetting — each requiring a privacy policy, a demo video and scope justification." },
  ],
  security: {
    body: "Access and refresh tokens are encrypted at rest in Supabase Vault — only an opaque vault id is stored in the database, and a token value never reaches the browser.",
  },
  footnote: "Demo — no real OAuth runs.",
};

export function SocialsConnectButton({
  connectedCount,
  total = 5,
  autoOpen,
  children,
}: {
  connectedCount: number;
  total?: number;
  autoOpen?: boolean;
  children?: React.ReactNode;
}) {
  // Production-shaped props kept on the contract but unused in the demo.
  void autoOpen;
  void children;

  return (
    <div className="hidden items-center gap-3 md:flex">
      <span className="whitespace-nowrap text-[12px] text-[var(--text-tertiary)]">
        {connectedCount}/{total} connected
      </span>
      <HowItWorks {...CONNECT_EXPLAINER}>
        {(open) => (
          <button
            type="button"
            onClick={open}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ps-yellow)] px-3.5 py-2 text-[13px] font-semibold text-[var(--text-on-yellow)] transition-colors hover:bg-[var(--ps-yellow-soft)]"
          >
            <Plus size={15} />
            Connect Platform
          </button>
        )}
      </HowItWorks>
    </div>
  );
}

/** Empty-state "Connect Platform" CTA — opens the same explainer. */
export function OpenSocialsConnectButton({
  className,
  label = "Connect Platform",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <HowItWorks {...CONNECT_EXPLAINER}>
      {(open) => (
        <button
          type="button"
          onClick={open}
          className={
            className ??
            "inline-flex h-10 items-center gap-2 rounded-md bg-[var(--ps-yellow)] px-4 text-[13px] font-semibold text-[var(--text-on-yellow)] transition-colors hover:bg-[var(--ps-yellow-soft)]"
          }
        >
          <Plus size={15} />
          {label}
        </button>
      )}
    </HowItWorks>
  );
}
