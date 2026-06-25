// READ-ONLY: try to read Supabase Auth audit events from the DB (auth schema).
//   npx tsx --env-file=.env.local scripts/diag-authlog.ts <email-substr>
import { createClient } from "@supabase/supabase-js";

const needle = (process.argv[2] ?? "").toLowerCase();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

(async () => {
  const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: "auth" } as never });
  const { data, error } = await (sb as unknown as {
    from: (t: string) => { select: (c: string) => { order: (k: string, o: object) => { limit: (n: number) => Promise<{ data: Array<{ created_at: string; payload: unknown }> | null; error: { message: string } | null }> } } };
  })
    .from("audit_log_entries")
    .select("created_at,payload")
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    console.log("auth.audit_log_entries NOT queryable via REST:", error.message);
    console.log("(expected — the `auth` schema isn't exposed through PostgREST. Email-send logs live in the Supabase dashboard, not the DB.)");
    return;
  }
  console.log("recent auth audit events" + (needle ? ` (filtering for ${needle})` : "") + ":");
  for (const r of data ?? []) {
    const s = JSON.stringify(r.payload);
    if (!needle || s.toLowerCase().includes(needle)) console.log(" ", r.created_at, s.slice(0, 200));
  }
})();
