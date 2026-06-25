/**
 * Edge proxy — gates protected routes behind Supabase auth and keeps the
 * session cookies fresh on every request.
 *
 * Renamed from the legacy `middleware.ts` convention to Next 16's new
 * `proxy.ts` convention. Identical behavior; only the file name + exported
 * function name changed.
 *
 * - Public routes: `/login`, `/auth/*`, `/no-access`
 * - Everything else: requires a signed-in user, otherwise redirects to /login
 * - If a signed-in user hits /login, bounce them to /dashboard
 *
 * We deliberately don't check the user's email-domain access here — that's
 * cheap to do server-side in the dashboard route itself, and avoids putting
 * a DB call into every request. Proxy just keeps the session alive.
 */
import { createServerClient as createSSRClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/no-access",
  // Privacy + terms pages must be publicly accessible — OAuth platform
  // reviewers (Meta App Review, Google's brand verification, TikTok app
  // review, LinkedIn Microsoft Vetting) all scrape these URLs without
  // auth to verify they exist + contain real policy text. The paths match
  // TikTok's required convention verbatim: <domain>/privacy-policy and
  // <domain>/terms-of-service.
  "/privacy-policy",
  "/terms-of-service",
  // Security Lab — the public, interactive attack/defense demos. Kept open
  // (like the landing + legal pages) so it can be linked/shared directly
  // without a login. It runs entirely client-side on synthetic data.
  "/security",
];

function isPublic(pathname: string): boolean {
  // API routes handle their own auth — the proxy must NOT redirect them
  // to /login. /api/cron/* uses Bearer CRON_SECRET, /api/etl/* accepts
  // either Bearer CRON_SECRET or a super-admin session. The route
  // handlers gate everything; the proxy just keeps cookies fresh for
  // the cookie-based callers.
  if (pathname.startsWith("/api/")) return true;

  // Static verification files served from web/public/. OAuth platform
  // reviewers (TikTok, Google, etc.) fetch these WITHOUT an auth cookie
  // to confirm domain ownership. If the proxy redirects them to /login,
  // the verifier reads the HTML login page instead of the token and
  // reports "couldn't find verification signature."
  //
  // Patterns recognized:
  //   - /tiktok<random>.txt  — TikTok URL-prefix verification
  //   - /google<random>.html — Google site verification (Search Console,
  //     YouTube Brand Account claims)
  //   - /robots.txt          — search engine crawlers
  //   - /sitemap.xml         — same
  //
  // Add more patterns here when new platforms issue their own files.
  if (
    /^\/(tiktok[\w-]+\.txt|google[\w-]+\.html|robots\.txt|sitemap\.xml)$/i.test(pathname)
  ) {
    return true;
  }

  // Root `/` is a PUBLIC landing page (product description + "Log in" CTA), so
  // the app has a real NON-login website URL on the same domain as
  // /terms-of-service, /privacy-policy, and the OAuth redirect — what
  // TikTok/Meta app review require.
  // The page itself redirects signed-in users straight to their dashboard, so
  // the actual dashboard stays gated. Exact-match only (not a prefix).
  if (pathname === "/") return true;

  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session — also reveals whether we have an authenticated user.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (isPublic(path)) {
    // If they're already signed in and visiting /login, bounce to root which
    // does smart routing (super-admin → /clients, client-user → /[slug]).
    if (user && path === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return response;
  }

  // Protected: require auth
  if (!user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on everything except static files / images / favicons / brand SVGs.
  // Any path with a static-asset extension (the logo, favicon, fonts, etc.) is
  // excluded so the auth gate never redirects a public asset to /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/.*|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|txt|xml)).*)",
  ],
};
