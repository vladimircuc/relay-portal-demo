/**
 * Server-side Supabase clients.
 *
 * - `createServerClient()` uses cookies + the anon key + RLS, scoped to the
 *   authenticated user. This is the default for reading client-scoped data.
 *
 * - `createAdminClient()` uses the service-role key and bypasses RLS. Only
 *   use it for ETL writes and admin operations. Never expose it to the
 *   browser.
 */
import { createServerClient as createSSRClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export async function createServerClient() {
  const cookieStore = await cookies();

  return createSSRClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — Next.js doesn't allow setting
            // cookies there. The middleware will refresh them on the next req.
          }
        },
      },
    },
  );
}

/** Service-role client — bypasses RLS. Server-only. */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
