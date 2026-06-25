"use client";

/**
 * Thin wrapper around next/link that ALSO drives the global navigation
 * progress bar (`useNavProgress`). Use it anywhere a regular <Link> would
 * feel "dead" until the destination renders — admin client grid, "All
 * clients" dropdown link, etc.
 *
 * Two signals feed the bar, and we need BOTH:
 *
 *  1. onClick → nav.start(): lights the bar the instant you click, before
 *     React has even begun the transition. Gives immediate feedback.
 *
 *  2. <LinkPending> → useLinkStatus(): keeps the bar lit for the WHOLE
 *     navigation. `pending` stays true until the destination actually
 *     renders, so it spans the slow server round-trip (auth + access
 *     resolution on the client home route can take 3-4s). Without this the
 *     bar dies early: <TopProgress> auto-stops when the pathname settles,
 *     which in Next 16 happens mid-navigation (old page still on screen),
 *     leaving several seconds of zero feedback — the bug this fixes.
 *
 * Same prop surface as next/link, so it's a drop-in replacement.
 */
import Link, { useLinkStatus } from "next/link";
import { useEffect } from "react";
import type { ComponentProps, MouseEvent } from "react";
import { useNavProgress } from "./nav-progress";

type Props = ComponentProps<typeof Link>;

export function ProgressLink({ onClick, children, ...rest }: Props) {
  const nav = useNavProgress();

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // Only fire the bar for a "real" navigation — not modifier-clicks
    // (cmd/ctrl/shift) which open in a new tab, and not right-clicks.
    const isPlainLeftClick =
      e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
    if (isPlainLeftClick) nav.start();
    onClick?.(e);
  }

  return (
    <Link {...rest} onClick={handleClick}>
      {children}
      <LinkPending />
    </Link>
  );
}

/**
 * Renders nothing — exists purely to call useLinkStatus(), which MUST run
 * inside a <Link>. While THIS link's navigation is pending it holds a slot in
 * the provider's ref-count, keeping the bar visible until the destination
 * renders. The single-release guard + 20s defensive timeout ensure the count
 * can never get stuck incremented (which would pin the bar on forever).
 */
function LinkPending() {
  const { pending } = useLinkStatus();
  const { addPending, removePending } = useNavProgress();

  useEffect(() => {
    if (!pending) return;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      removePending();
    };
    addPending();
    const safety = setTimeout(release, 20000);
    return () => {
      clearTimeout(safety);
      release();
    };
  }, [pending, addPending, removePending]);

  return null;
}
