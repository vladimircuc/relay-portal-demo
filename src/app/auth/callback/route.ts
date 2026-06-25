/**
 * OAuth callback handler.
 *
 * Supabase's signInWithOAuth / signInWithOtp (with magic link) sends the
 * browser back to this endpoint with a `code` query param. We exchange that
 * code for a session cookie and then route the user to the right landing
 * spot based on their access role.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { resolveAccess } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-next";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Honor explicit `next` only when it's a safe same-site path (shared helper,
  // identical to the login page so the two can't drift). Empty → fall through to
  // role-based routing below.
  const wantedNext = safeNextPath(next, "");
  if (wantedNext) {
    return NextResponse.redirect(`${origin}${wantedNext}`);
  }

  // Otherwise, decide where to land based on the user's access level.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const access = await resolveAccess(user.email);
  switch (access.kind) {
    case "super_admin":
    case "admin":
      return NextResponse.redirect(`${origin}/clients`);
    case "client_user":
      return NextResponse.redirect(`${origin}/${access.client.slug}/home`);
    case "no_access":
      return NextResponse.redirect(`${origin}/no-access`);
  }
}
