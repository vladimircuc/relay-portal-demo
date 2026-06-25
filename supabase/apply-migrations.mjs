// Applies migrations 033-044 (the Web/SEO deltas) from the source repo's
// migrations folder on top of schema.sql, so all 3 services can be enabled.
// Statement-by-statement, tolerating the same Supabase-managed-privilege skips.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const MIG = "C:/Users/vladi/posted-social-portal-fullhistory/dashboard/migrations";
const env = readFileSync("C:/Users/vladi/relay-portal-demo/.env.local", "utf8");
const connectionString = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();

function splitStatements(sql) {
  const out = [];
  let cur = "", i = 0;
  const n = sql.length;
  let line = false, block = false, single = false, dollar = null;
  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (line) { cur += ch; if (ch === "\n") line = false; i++; continue; }
    if (block) { cur += ch; if (two === "*/") { cur += "/"; i += 2; block = false; } else i++; continue; }
    if (dollar) { if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; } else { cur += ch; i++; } continue; }
    if (single) { cur += ch; if (ch === "'") { if (sql[i + 1] === "'") { cur += "'"; i += 2; continue; } single = false; } i++; continue; }
    if (two === "--") { line = true; cur += two; i += 2; continue; }
    if (two === "/*") { block = true; cur += two; i += 2; continue; }
    if (ch === "'") { single = true; cur += ch; i++; continue; }
    if (ch === "$") { const tag = sql.slice(i).match(/^\$[a-zA-Z0-9_]*\$/); if (tag) { dollar = tag[0]; cur += dollar; i += dollar.length; continue; } }
    if (ch === ";") { const t = cur.trim(); if (t) out.push(t); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  const t = cur.trim(); if (t) out.push(t);
  return out;
}

const files = readdirSync(MIG).filter((f) => /^0(3[3-9]|4[0-4])_.+\.sql$/.test(f)).sort();
console.log("applying:", files.join(", "));

const client = new pg.Client({ connectionString });
await client.connect();
let okT = 0, failT = 0;
const fails = [];
for (const f of files) {
  const sql = readFileSync(resolve(MIG, f), "utf8");
  let ok = 0, fail = 0;
  for (const s of splitStatements(sql)) {
    try { await client.query(s); ok++; }
    catch (e) { fail++; fails.push(`${f}: ${e.message} :: ${s.slice(0, 70).replace(/\s+/g, " ")}`); }
  }
  okT += ok; failT += fail;
  console.log(`${f}: ok ${ok} fail ${fail}`);
}
console.log(`TOTAL ok ${okT} fail ${failT}`);
for (const x of fails.slice(0, 40)) console.log("  FAIL:", x);
const t = await client.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name");
console.log("\nTABLES NOW (" + t.rows.length + "):", t.rows.map((r) => r.table_name).join(", "));
const enums = await client.query(`select t.typname, string_agg(e.enumlabel,',' order by e.enumsortorder) l from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' group by t.typname`);
for (const r of enums.rows) console.log("ENUM", r.typname + ":", r.l);
await client.end();
