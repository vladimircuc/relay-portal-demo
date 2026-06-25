// Applies supabase/schema.sql to the project's database, statement-by-statement
// so a few Supabase-managed-privilege lines (ALTER DEFAULT PRIVILEGES FOR ROLE
// supabase_admin/postgres) can be skipped without aborting the whole load — the
// explicit GRANTs in the dump already cover every created object.
// Reads DATABASE_URL from .env.local (gitignored). Run: node supabase/apply-schema.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, "..");

const env = readFileSync(resolve(root, ".env.local"), "utf8");
const m = env.match(/^DATABASE_URL=(.+)$/m);
if (!m) {
  console.error("DATABASE_URL not found in .env.local");
  process.exit(1);
}
const connectionString = m[1].trim();
const schema = readFileSync(resolve(dir, "schema.sql"), "utf8");

/** Split SQL into statements, respecting --/* * / comments, '...' strings and $tag$ bodies. */
function splitStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  let line = false, block = false, single = false, dollar = null;
  while (i < n) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (line) { cur += ch; if (ch === "\n") line = false; i++; continue; }
    if (block) { cur += ch; if (two === "*/") { cur += "/"; i += 2; block = false; } else i++; continue; }
    if (dollar) {
      if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; }
      else { cur += ch; i++; }
      continue;
    }
    if (single) {
      cur += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { cur += "'"; i += 2; continue; }
        single = false;
      }
      i++; continue;
    }
    if (two === "--") { line = true; cur += two; i += 2; continue; }
    if (two === "/*") { block = true; cur += two; i += 2; continue; }
    if (ch === "'") { single = true; cur += ch; i++; continue; }
    if (ch === "$") {
      const tag = sql.slice(i).match(/^\$[a-zA-Z_0-9]*\$/);
      if (tag) { dollar = tag[0]; cur += dollar; i += dollar.length; continue; }
    }
    if (ch === ";") { const t = cur.trim(); if (t) out.push(t); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  const t = cur.trim();
  if (t) out.push(t);
  return out;
}

const client = new pg.Client({ connectionString });
await client.connect();
console.log("connected");

try {
  try { await client.query("create extension if not exists supabase_vault;"); console.log("vault extension ok"); }
  catch (e) { console.log("vault extension skipped:", e.message); }

  const stmts = splitStatements(schema);
  let ok = 0, fail = 0;
  const fails = [];
  for (const stmt of stmts) {
    try { await client.query(stmt); ok++; }
    catch (e) { fail++; fails.push({ msg: e.message, head: stmt.slice(0, 90).replace(/\s+/g, " ") }); }
  }
  console.log(`statements: ${stmts.length}  ok: ${ok}  failed: ${fail}`);
  for (const f of fails.slice(0, 40)) console.log(`  FAIL: ${f.msg}  ::  ${f.head}`);

  const t = await client.query(
    "select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
  );
  console.log("public base tables:", t.rows[0].n);
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
