/**
 * Relay logo lockup.
 * - `variant="icon"` renders just the logo mark
 * - `variant="full"` renders mark + wordmark
 *
 * The logo is clickable by default — it links to `/`, which does smart
 * access-based routing in `src/app/page.tsx`:
 *   - multi-client (super_admin / admin) → /clients
 *   - single-client (client_user)        → /{their-slug}/ads
 *   - unauthenticated                    → /login
 *
 * Pass `href={null}` to render a non-clickable logo (the login page does
 * this so the logo on /login doesn't bounce the user away mid-flow).
 */
import Link from "next/link";

type Props = {
  variant?: "icon" | "full";
  size?: number;
  className?: string;
  /**
   * Destination for clicking the logo. Defaults to `/` which smart-
   * routes by access tier. Pass `null` to render a plain non-clickable logo.
   */
  href?: string | null;
};

export function Logo({ variant = "full", size = 32, className, href = "/" }: Props) {
  const mark = (
    <span
      className="inline-block shrink-0 overflow-hidden rounded-[7px] ring-1 ring-[var(--surface-3)]"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/relay-logo.png"
        alt="Relay"
        width={size}
        height={size}
        className="h-full w-full object-cover"
      />
    </span>
  );

  const inner =
    variant === "icon" ? (
      <span className={className}>{mark}</span>
    ) : (
      <span className={`inline-flex items-center gap-3 ${className ?? ""}`}>
        {mark}
        <span
          className="font-semibold tracking-tight text-[var(--text-primary)]"
          style={{ fontSize: size * 0.78, lineHeight: 1 }}
        >
          Relay
        </span>
      </span>
    );

  if (!href) return inner;

  return (
    <Link
      href={href}
      aria-label="Relay — go home"
      className="inline-flex items-center hover:opacity-90 transition-opacity"
    >
      {inner}
    </Link>
  );
}
