import type { NextConfig } from "next";

// Static security headers from the 2026 audit, applied to every response.
const SECURITY_HEADERS = [
  // Force HTTPS for 2 years incl. subdomains. Vercel serves HTTPS only.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Deny framing — kills clickjacking of the authenticated dashboard.
  // (SameSite=Lax cookies do NOT defend framing: a frame carries first-party cookies.)
  { key: "X-Frame-Options", value: "DENY" },
  // No MIME sniffing — the client-logos bucket is public.
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // frame-ancestors supersedes X-Frame-Options; base-uri/form-action are safe as
  // static directives. A script-src/style-src CSP is intentionally NOT set here —
  // it needs per-request nonces (Next injects its own inline bootstrap scripts).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  // Keep the headless-Chrome packages out of the bundler. puppeteer-core has
  // native-ish requires; @sparticuz/chromium-min loads its remote pack at
  // runtime. (chromium-min ships no binary, so there's nothing for the file
  // tracer to drop — which is why the full @sparticuz/chromium failed on
  // Vercel with "bin does not exist".) The report route fetches the Chromium
  // pack from CHROMIUM_PACK_URL at runtime instead.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium-min"],
  // Serve images as-is. Next 16's optimizer needs sharp, which is flaky on some
  // local boxes (the brand logo 400'd via /_next/image). Demo payloads are tiny,
  // so skipping optimization is harmless and renders everywhere.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
