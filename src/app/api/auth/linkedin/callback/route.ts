/**
 * GET /api/auth/linkedin/callback?code=...&state=...
 *
 * Exchange code → tokens, fetch the user's admin'd organizations, pick
 * the first one (typically the only one). Store refresh_token in vault
 * + org URN/name in client_social_credentials.
 *
 * Note: while the LinkedIn app awaits Community Management API approval
 * (Standard Tier), the OAuth grant succeeds but /organizationAcls returns
 * a 403 — we surface that with a clear message so the user knows it's
 * an approval gate, not a code bug.
 */
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireClientAccess } from "@/lib/auth";
import { setVaultSecret } from "@/lib/etl/vault";
import {
  exchangeCodeForTokens,
  verifyState,
  callbackUrlFromRequest,
} from "@/lib/linkedin-oauth";

export const runtime = "edge";

type OrgAcl = {
  organization?: string;          // URN e.g. "urn:li:organization:1234"
  role?: string;                  // "ADMINISTRATOR" etc.
  state?: string;                 // "APPROVED"
};
type OrgAclsResponse = {
  elements?: OrgAcl[];
};
type OrgDetails = {
  id?: number;
  localizedName?: string;
  vanityName?: string;
  logoV2?: { original?: string };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    redirect(`/clients?linkedin_oauth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) return new Response("Missing code or state", { status: 400 });

  const linkedinClientId = process.env.LINKEDIN_CLIENT_ID;
  const linkedinClientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!linkedinClientId || !linkedinClientSecret) {
    return new Response("LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET not configured", { status: 500 });
  }

  const verified = await verifyState({ state, secret: linkedinClientSecret });
  if (!verified.ok) return new Response(`OAuth state rejected: ${verified.reason}`, { status: 400 });
  const clientId = verified.clientId;

  // Authz: re-assert client access here, mirroring the /start gate.
  // /start already checked, but a replayed or hand-crafted callback would
  // otherwise persist a token for a client the current session can't access.
  // Runs BEFORE the token exchange so an unauthorized hit makes zero outbound
  // API calls. Edge-safe (same helper the /start routes use).
  await requireClientAccess(clientId);

  const redirectUri = callbackUrlFromRequest(request);

  // ── 1) Token exchange ──────────────────────────────────────────────────
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      clientId: linkedinClientId,
      clientSecret: linkedinClientSecret,
      redirectUri,
      code,
    });
  } catch (e) {
    const errorId = crypto.randomUUID();
    console.error(`[auth/linkedin/callback] token exchange failed (errorId=${errorId})`, e);
    return new Response(`Token exchange failed (ref ${errorId})`, { status: 502 });
  }

  // ── 2) Look up admin'd organizations ───────────────────────────────────
  // /v2/organizationAcls returns the orgs the user has roles on. We
  // filter to ADMINISTRATOR + APPROVED so we don't surface pending or
  // recruiter-only relationships.
  const aclsRes = await fetch(
    "https://api.linkedin.com/v2/organizationAcls?q=roleAssignee" +
      "&role=ADMINISTRATOR&state=APPROVED",
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      cache: "no-store",
    },
  );
  if (!aclsRes.ok) {
    const body = await aclsRes.text();
    if (aclsRes.status === 403) {
      return new Response(
        "LinkedIn returned 403 on /organizationAcls. Most common cause: the " +
          "Community Management API isn't approved on your LinkedIn app yet. " +
          "Submit a request in the LinkedIn Developer portal (Products tab → " +
          "Community Management API → Request Access). Approval typically takes " +
          `1-2 weeks. Raw error: ${body.slice(0, 200)}`,
        { status: 502 },
      );
    }
    return new Response(`LinkedIn /organizationAcls failed (${aclsRes.status}): ${body.slice(0, 400)}`, {
      status: 502,
    });
  }
  const acls = ((await aclsRes.json()) as OrgAclsResponse).elements ?? [];
  if (acls.length === 0) {
    return new Response(
      "No LinkedIn Company Pages were returned. The signed-in user must be a " +
        "designated ADMINISTRATOR on at least one Page (Page → Admin tools).",
      { status: 400 },
    );
  }

  // For now: pick the first admin'd org. Multi-org picker like Meta's
  // would slot in later if needed.
  const orgUrn = acls[0].organization ?? "";
  if (!orgUrn) return new Response("ACL response missing organization URN", { status: 502 });
  const orgId = orgUrn.split(":").pop();

  // ── 3) Fetch org details for display ───────────────────────────────────
  const orgRes = await fetch(
    `https://api.linkedin.com/v2/organizations/${orgId}` +
      `?projection=(id,localizedName,vanityName,logoV2)`,
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      cache: "no-store",
    },
  );
  let org: OrgDetails = {};
  if (orgRes.ok) org = (await orgRes.json()) as OrgDetails;
  // If org details fail we still persist the URN — display falls back to the URN itself.

  // ── 4) Persist ─────────────────────────────────────────────────────────
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("client_social_credentials")
    .select("access_token_secret_id")
    .eq("client_id", clientId).eq("platform", "linkedin").maybeSingle();

  const secretId = await setVaultSecret(supabase, {
    existingId: (existing?.access_token_secret_id as string | undefined) ?? null,
    secretValue: tokens.refresh_token,
    secretName: `linkedin_refresh_token__${clientId}__${orgId}`,
  });

  const { error: upsertErr } = await supabase
    .from("client_social_credentials")
    .upsert(
      {
        client_id: clientId,
        platform: "linkedin",
        access_token_secret_id: secretId,
        linkedin_org_urn: orgUrn,
        linkedin_org_name: org.localizedName ?? null,
        linkedin_vanity_name: org.vanityName ?? null,
        // logoV2.original is a digital media URN; resolving it to a URL
        // requires another roundtrip. Skip for now — admin display
        // falls back to a generic LinkedIn icon.
        linkedin_org_logo_url: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,platform" },
    );
  if (upsertErr) return new Response(`DB upsert failed: ${upsertErr.message}`, { status: 500 });

  const { data: clientRow } = await supabase
    .from("clients").select("slug").eq("id", clientId).maybeSingle();
  const slug = (clientRow?.slug as string | undefined) ?? "";

  redirect(`/${slug}/admin?linkedin_connected=1#social-credentials`);
}
