"use client";

/**
 * Wraps the /admin page content and turns every real mutation into an explainer.
 *
 * Two capture-phase listeners cover the whole surface:
 *
 *   - onSubmitCapture — every settings control on /admin is a
 *     `<form action={serverAction}>`. We preventDefault in the capture phase so
 *     the server action never runs, then resolve which section the form lives in
 *     (via the nearest `[data-explain]` ancestor) and open that section's modal.
 *
 *   - onClickCapture — the only non-form actions are the OAuth connect/reconnect
 *     links, which point at `/api/auth/<platform>/start`. We match those by href
 *     and open the social-OAuth explainer before the browser navigates.
 *
 * Everything else (tab switching, expanding the stage table, internal jumplinks,
 * checkbox toggles) is left untouched, so the page still feels fully interactive.
 *
 * The wrapper uses `display: contents` so it doesn't disturb the parent <main>'s
 * flex layout — it exists purely as an event boundary. The modal portals to
 * <body>, so its own clicks never re-enter these handlers.
 *
 * This is the UX layer; `assertWritable()` in each server action is the
 * server-side backstop for anything that bypasses the browser entirely.
 */
import { useCallback, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { HowItWorksModal, type ExplainerContent } from "@/components/how-it-works";
import { ADMIN_EXPLAINERS, FALLBACK_EXPLAINER } from "./admin-explainers";

export function DemoActionInterceptor({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ExplainerContent | null>(null);

  const openByKey = useCallback((key: string | null | undefined) => {
    setContent((key && ADMIN_EXPLAINERS[key]) || FALLBACK_EXPLAINER);
  }, []);

  const onClickCapture = useCallback(
    (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      // OAuth connect / reconnect links point at /api/auth/<platform>/start.
      const oauthLink = target.closest('a[href^="/api/auth/"]');
      if (oauthLink) {
        e.preventDefault();
        e.stopPropagation();
        openByKey("social-oauth");
        return;
      }

      // Any submit button inside a settings form is a real mutation. We catch
      // the CLICK in the capture phase — before native form validation runs —
      // so an empty required field can't block the explainer from opening.
      // type="button" controls (tab switches, the ETL/Report explainer buttons)
      // are left alone so they keep working.
      const btn = target.closest<HTMLButtonElement>("button");
      if (btn && btn.closest("form") && btn.type !== "button") {
        e.preventDefault();
        e.stopPropagation();
        const section = btn.closest<HTMLElement>("[data-explain]");
        openByKey(section?.dataset.explain);
      }
    },
    [openByKey],
  );

  const onSubmitCapture = useCallback(
    (e: FormEvent) => {
      // Backstop for keyboard submits (Enter in a field) that don't click a
      // button — onClickCapture handles the common case.
      e.preventDefault();
      e.stopPropagation();
      const section = (e.target as Element | null)?.closest<HTMLElement>("[data-explain]");
      openByKey(section?.dataset.explain);
    },
    [openByKey],
  );

  return (
    <div style={{ display: "contents" }} onSubmitCapture={onSubmitCapture} onClickCapture={onClickCapture}>
      {children}
      {content && <HowItWorksModal content={content} onClose={() => setContent(null)} />}
    </div>
  );
}
