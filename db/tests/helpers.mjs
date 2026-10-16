// Shared fixtures for the database tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDatabase } from "./run.mjs";
import { loadDataset } from "../../tools/upstream-import/load.mjs";
import { applyDecisions } from "../../tools/upstream-import/review.mjs";
import { writeMiniDataset, KEYS } from "../../tools/upstream-import/test/fixtures/mini-dataset.mjs";

export const REVIEWER = "00000000-0000-0000-0000-0000000000f1";
export const PLAIN = "00000000-0000-0000-0000-0000000000f2";
export { KEYS };

export const one = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
export const num = async (db, sql, p = []) => Number((await one(db, sql, p)).n);

/** Loaded synthetic dataset plus a reviewer and a plain user. */
export async function loadedDb() {
  const db = await freshDatabase();
  const dir = writeMiniDataset(fs.mkdtempSync(path.join(os.tmpdir(), "db-test-")));
  await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  await db.query("insert into auth.users (id) values ($1), ($2)", [REVIEWER, PLAIN]);
  await db.query("insert into app_role (user_id, role) values ($1, 'reviewer')", [REVIEWER]);
  return { db, dir };
}

/** Same, with candidate A approved and published through the real functions (all gates pass). */
export async function publishedDb() {
  const { db, dir } = await loadedDb();
  const id = (await one(db, "select id from candidate where canonical_key = $1", [KEYS.A])).id;
  await db.query(`insert into listing_draft (candidate_id, title, summary, summary_kind, summary_approved_by, summary_approved_at, content_type, install_text,
      licence, last_checked_at, evidence_level, source_links) values ($1, 'Alpha', 'Reviewer-written summary.', 'reviewer_written', $2, now(), 'server', 'not documented',
      'unknown', now(), 2, '[{"url":"https://example.org/alpha","kind":"repo"}]')`, [id, REVIEWER]);
  const res = await applyDecisions(db, [
    { canonical_key: KEYS.A, action: "clear_removal_hold", reason: "classifier hold reviewed, unrelated project" },
    { canonical_key: KEYS.A, action: "approve", reason: "individually approved" },
  ], { reviewerId: REVIEWER });
  if (res.some((r) => r.error)) throw new Error("fixture approval failed: " + JSON.stringify(res));
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [REVIEWER]);
  await db.query("select publish_listing($1, 'alpha')", [id]);
  await db.query("commit");
  return { db, dir, id };
}

/** Run `fn` with the session role switched (and always switched back). */
export async function asRole(db, role, sub, fn) {
  await db.query(`set role ${role}`);
  if (sub) await db.query("select set_config('request.jwt.claim.sub', $1, false)", [sub]);
  try { return await fn(); } finally { await db.query("reset role"); await db.query("select set_config('request.jwt.claim.sub', '', false)"); }
}
