// Local verification: load a pipeline output directory into an in-process Postgres, build template drafts for every eligible
// candidate and report how many drafts could be built and why the others were skipped. Nothing is persisted or published.
// Usage: node db/tests/draft-coverage.mjs <data-dir>
import { freshDatabase } from "./run.mjs";
import { loadDataset } from "../../tools/upstream-import/load.mjs";
import { prepareDrafts } from "../../tools/upstream-import/review.mjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: node db/tests/draft-coverage.mjs <data-dir>"); process.exit(2); }
const REVIEWER = "00000000-0000-0000-0000-0000000000f1";
const db = await freshDatabase();
await loadDataset({ db, dataDir: dir, sourceRepo: "chatmcp/mcpso", note: "draft coverage check" });
await db.query("insert into auth.users (id) values ($1)", [REVIEWER]);
await db.query("insert into app_role (user_id, role) values ($1, 'reviewer')", [REVIEWER]);
const eligible = Number((await db.query("select count(*) n from candidate where status = 'eligible'")).rows[0].n);
const r = await prepareDrafts(db, REVIEWER, { limit: eligible });
const reasons = {};
for (const s of r.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
const byLevel = (await db.query("select evidence_level l, count(*)::int n from listing_draft group by 1 order by 1")).rows;
console.log(JSON.stringify({ eligible, drafts_built: r.saved.length, skipped: r.skipped.length, skipped_by_reason: reasons, drafts_by_evidence_level: byLevel, approved_summaries: 0 }, null, 1));
