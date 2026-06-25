/**
 * Bare-slug landing — redirects to the client's Home tab.
 *
 * Home is the universal landing every client has (Ads/Socials are
 * per-client entitlements, so neither is guaranteed to exist). This page
 * keeps links to bare `/<slug>` working — bookmarks, old emails, the root
 * smart-router, the auth callback, etc. all funnel through Home, which then
 * surfaces whichever product tabs the client is entitled to.
 *
 * Reserved app routes (login, clients, admin, …) still 404 here so they
 * don't bounce into `/<reserved>/home`.
 */
import { notFound, redirect } from "next/navigation";

export const runtime = "edge";

const RESERVED_SLUGS = new Set([
  "login", "logout", "auth", "no-access", "clients", "api", "admin", "favicon.ico",
]);

export default async function ClientRootPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  if (RESERVED_SLUGS.has(clientSlug)) notFound();
  redirect(`/${clientSlug}/home`);
}
