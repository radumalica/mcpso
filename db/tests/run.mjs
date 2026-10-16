// Applies the Supabase shim, every migration in db/migrations (in name order) and the SQL test files to a fresh in-process
// Postgres (PGlite). Usage: node db/tests/run.mjs [--keep-going]. Exit code 0 only if everything applied and every test passed.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const DB = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

export async function freshDatabase({ migrations = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(read(path.join(DB, "tests/supabase_shim.sql")));
  if (migrations) {
    const dir = path.join(DB, "migrations");
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) await db.exec(read(path.join(dir, f)));
  }
  return db;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0;
  const step = async (label, fn) => {
    try { await fn(); console.log(`ok   ${label}`); } catch (e) { failed++; console.log(`FAIL ${label}\n     ${String(e.message || e).split("\n")[0]}${e.detail ? `\n     detail: ${e.detail}` : ""}${e.where ? `\n     where: ${e.where}` : ""}`); }
  };
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
  await step("supabase shim", () => db.exec(read(path.join(DB, "tests/supabase_shim.sql"))));
  const dir = path.join(DB, "migrations");
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) await step(`migration ${f}`, () => db.exec(read(path.join(dir, f))));
  const tdir = path.join(DB, "tests");
  for (const f of fs.readdirSync(tdir).filter((n) => n.endsWith(".test.sql")).sort()) await step(`test ${f}`, () => db.exec(read(path.join(tdir, f))));
  console.log(failed ? `${failed} step(s) failed` : "all steps passed");
  process.exit(failed ? 1 : 0);
}
