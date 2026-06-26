import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { NavProgressProvider, TopProgress } from "@/components/nav-progress";
import { Footer } from "@/components/footer";
import { ThemeProvider } from "@/components/theme-context";
import { THEME_INIT_SCRIPT } from "@/lib/prefs";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Platform site-verification meta tags. Each OAuth platform may demand
// its own tag to prove we own portal.posted-social.com before approving
// production access:
//   - TikTok issues `tiktok-developers-site-verification`
//   - Google uses `google-site-verification` (fetched from the ROOT URL,
//     not /privacy-policy — that's why this hook lives on the root layout,
//     not just on /privacy-policy where it started)
//   - Meta uses `facebook-domain-verification`
//
// Setting any of the env vars below adds the matching tag to <head>
// across the whole site without redeploying anything else.
function siteVerificationTags(): Record<string, string> {
  const out: Record<string, string> = {};
  if (process.env.TIKTOK_VERIFICATION_CODE) {
    out["tiktok-developers-site-verification"] = process.env.TIKTOK_VERIFICATION_CODE;
  }
  if (process.env.GOOGLE_VERIFICATION_CODE) {
    out["google-site-verification"] = process.env.GOOGLE_VERIFICATION_CODE;
  }
  if (process.env.META_DOMAIN_VERIFICATION) {
    out["facebook-domain-verification"] = process.env.META_DOMAIN_VERIFICATION;
  }
  return out;
}

export const metadata: Metadata = {
  // Absolute base so the Open Graph / Twitter image URLs resolve to the live
  // domain (Next needs this to turn /cover.png into a full https URL).
  metadataBase: new URL("https://relay.vladimircuc.com"),
  // Exactly "Relay" — TikTok app review requires the website title to
  // match the app name verbatim (app name, domain posted-social.com, and this
  // title all align). Inner pages can still set their own titles.
  title: "Relay",
  description: "Lead-gen performance dashboard for Relay clients.",
  icons: {
    icon: "/relay-logo.png",
  },
  // Link-preview card shown when relay.vladimircuc.com is shared (LinkedIn,
  // Twitter/X, Slack, etc.). Uses the cyberpunk dashboard cover.
  openGraph: {
    type: "website",
    siteName: "Relay",
    url: "https://relay.vladimircuc.com",
    title: "Relay, built with AI and hardened to take a beating",
    description:
      "A full analytics platform built with AI, then hardened until it could take a real beating. It's live, and you're invited to attack it.",
    images: [{ url: "/cover.png", width: 1672, height: 941, alt: "Relay secure analytics dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Relay, built with AI and hardened to take a beating",
    description:
      "A full analytics platform built with AI, then hardened until it could take a real beating. Come try to break it.",
    images: ["/cover.png"],
  },
  other: siteVerificationTags(),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` on <html> silences the mismatch warning for
    // the `data-theme` attribute, which the pre-hydration script below writes
    // before React hydrates (so it's never in the server markup).
    <html
      lang="en"
      className={`${montserrat.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/*
        `suppressHydrationWarning` on <body> silences React's "client HTML
        doesn't match server HTML" warning for THIS specific element —
        not its children. Browser extensions (ColorZilla's
        `cz-shortcut-listen`, Grammarly's `data-gr-*`, dark-mode
        injectors, etc.) inject attributes onto <body> before React
        hydrates, which would otherwise trigger a console error on
        every page load for affected users. Scoped to <body> only so
        any real hydration mismatch elsewhere still surfaces.
      */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* No-flash theme init. Runs synchronously as the first body node —
            before any content paints — so light/dark is correct on the very
            first frame. Reads the ps_theme cookie, else the OS preference.
            See THEME_INIT_SCRIPT in lib/prefs.ts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Global thin yellow progress bar at the very top — driven by
            useNavProgress(). Mounted once here so any client component
            can flip it on during route changes / refreshes. */}
        <ThemeProvider>
          <NavProgressProvider>
            <TopProgress />
            {/* Page content. `flex-1` pushes the footer to the bottom even
                on short pages — body is `min-h-full flex flex-col`. */}
            <div className="flex-1 flex flex-col">{children}</div>
            <Footer />
          </NavProgressProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
