/**
 * GET /api/auth/linkedin/start?clientId=<uuid>
 */
import { redirect } from "next/navigation";
import { requireClientAccess } from "@/lib/auth";
import {
  buildAuthUrl,
  signState,
  callbackUrlFromRequest,
} from "@/lib/linkedin-oauth";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") ?? "";
  if (!clientId) return new Response("Missing clientId", { status: 400 });

  await requireClientAccess(clientId);

  const linkedinClientId = process.env.LINKEDIN_CLIENT_ID;
  const linkedinClientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!linkedinClientId || !linkedinClientSecret) {
    return new Response(
      "LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET not configured. Finish " +
        "the LinkedIn Developer portal setup and add both to .env.local " +
        "(or Vercel env for prod), then retry.",
      { status: 500 },
    );
  }

  const state = await signState({ clientId, secret: linkedinClientSecret });
  const authUrl = buildAuthUrl({
    clientId: linkedinClientId,
    redirectUri: callbackUrlFromRequest(request),
    state,
  });

  redirect(authUrl);
}
