// Loads a pipeline output directory into a fresh in-process Postgres (PGlite, migrations applied) and prints the database
// reconciliation. Local verification only: nothing is persisted. Usage: node db/tests/load-snapshot.mjs <data-dir> [--twice]
import { freshDatabase } from "./run.mjs";
import { loadDataset, reconcileDatabase } from "../../tools/upstream-import/load.mjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: node db/tests/load-snapshot.mjs <data-dir> [--twice]"); process.exit(2); }
const db = await freshDatabase();
const count = async (t) => Number((await db.query(`select count(*) n from ${t}`)).rows[0].n);
const tables = ["source_record", "source_record_revision", "candidate", "eligibility_evaluation", "source_candidate_map"];
const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)])));

let t0 = Date.now();
const first = await loadDataset({ db, dataDir: dir, sourceRepo: "chatmcp/mcpso", note: "local verification load" });
console.log(`load 1: ${((Date.now() - t0) / 1000).toFixed(1)} s`, first.counts);
const afterFirst = await snapshot();
console.log("rows", afterFirst);
const rec = await reconcileDatabase(db, first.dataset);
for (const c of rec.checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name}: expected ${c.expected}, database ${c.actual}`);
let ok = rec.ok;
if (process.argv.includes("--twice")) {
  t0 = Date.now();
  const second = await loadDataset({ db, dataDir: dir, sourceRepo: "chatmcp/mcpso", note: "local verification reload" });
  const afterSecond = await snapshot();
  const same = JSON.stringify(afterFirst) === JSON.stringify(afterSecond);
  console.log(`load 2: ${((Date.now() - t0) / 1000).toFixed(1)} s`, second.counts, same ? "→ no new rows" : "→ ROWS CHANGED", afterSecond);
  ok = ok && same && second.counts.inserted === 0;
}
console.log(ok ? "RECONCILIATION OK" : "RECONCILIATION FAILED");
process.exit(ok ? 0 : 1);
