/**
 * Relay demo mode.
 *
 * This deployment is the PUBLIC, read-only demo of the Relay portal — a faithful
 * copy of the real product wired to a throwaway Supabase project seeded with
 * synthetic data. Nothing here should ever mutate that database from the UI:
 *
 *   1. The dashboard's action buttons (Refresh, Create Report, Connect) open a
 *      "how it works in production" explainer instead of running.
 *   2. The /admin page wraps its sections in <DemoActionInterceptor>, which
 *      catches every form submit + OAuth link click and shows an explainer.
 *   3. This module is the SERVER-SIDE backstop: `assertWritable()` sits at the
 *      top of every mutating server action, so even a hand-crafted POST that
 *      skips the UI can't write to the demo DB.
 *
 * The whole repo is the demo, so DEMO is a constant rather than an env toggle —
 * there is no "real" mode to fall back to here.
 */
export const DEMO = true;

export class DemoReadOnlyError extends Error {
  constructor(action?: string) {
    super(
      `Relay is in read-only demo mode${action ? ` — "${action}" is disabled` : ""}. ` +
        `In the live product this runs for real; here it's intentionally inert.`,
    );
    this.name = "DemoReadOnlyError";
  }
}

/**
 * Defense-in-depth guard for mutating server actions. Call it as the very first
 * line of any action that writes. In demo mode it throws before a single row is
 * touched; the UI never reaches it (the interceptor prevents the submit), so the
 * throw only ever fires for a direct, hand-crafted request.
 */
export function assertWritable(action?: string): never | void {
  if (DEMO) throw new DemoReadOnlyError(action);
}
