import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

const dir = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(dir, "..", ".env.local"), "utf8");
const connectionString = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const c = new pg.Client({ connectionString });
await c.connect();

const cols = await c.query(`
  select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema='public'
  order by table_name, ordinal_position`);
const byTable = {};
for (const r of cols.rows) {
  (byTable[r.table_name] ??= []).push(
    `${r.column_name} :: ${r.data_type}${r.is_nullable === "NO" ? " NOT NULL" : ""}${r.column_default ? ` default ${String(r.column_default).slice(0, 46)}` : ""}`,
  );
}
for (const [t, cs] of Object.entries(byTable)) {
  console.log(`\n### ${t}`);
  for (const col of cs) console.log("  " + col);
}

const views = await c.query(`select table_name from information_schema.views where table_schema='public' order by table_name`);
console.log("\n=== VIEWS:", views.rows.map((r) => r.table_name).join(", "));

const enums = await c.query(`
  select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) labels
  from pg_type t join pg_enum e on e.enumtypid=t.oid
  join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'
  group by t.typname`);
console.log("=== ENUMS:");
for (const r of enums.rows) console.log(`  ${r.typname}: ${r.labels}`);

await c.end();
