/**
 * One-shot: call runMetaPull for a client + date range. Used to manually
 * re-trigger a Meta backfill outside the admin UI (useful when diagnosing
 * stale data).
 */
import { runMetaPull } from "../src/lib/etl/meta";

async function main() {
  const [clientId, since, until] = process.argv.slice(2);
  if (!clientId || !since || !until) {
    console.error("usage: rerun-meta-backfill.ts <clientId> <since> <until>");
    process.exit(1);
  }
  const result = await runMetaPull({ clientId, since, until });
  console.log("rowsWritten:", result.rowsWritten);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
