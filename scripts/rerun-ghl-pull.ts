/**
 * One-shot: run the GHL pull for a client and surface any errors.
 * Mirrors rerun-meta-backfill.ts. Use when the daily cron or the
 * Refresh button logs a partial failure.
 */
import { runGhlPull } from "../src/lib/etl/ghl";

async function main() {
  const [clientId] = process.argv.slice(2);
  if (!clientId) {
    console.error("usage: rerun-ghl-pull.ts <clientId>");
    process.exit(1);
  }
  const result = await runGhlPull({ clientId });
  console.log("rowsWritten:", result.rowsWritten);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
