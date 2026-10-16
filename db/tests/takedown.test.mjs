// Correction/removal workflow (migration 0004) on a loaded database with one genuinely published listing.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDatabase } from "./run.mjs";
import { loadDataset } from "../../tools/upstream-import/load.mjs";
import { applyDecisions, recordTakedown, verifyTakedownOwnership, resolveTakedown } from "../../tools/upstream-import/review.mjs";
import { writeMiniDataset, KEYS } from "../../tools/upstream-import/test/fixtures/mini-dataset.mjs";

const REVIEWER = "00000000-0000-0000-0000-0000000000f1";
const PLAIN = "00000000-0000-0000-0000-0000000000f2";
const one = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
const num = async (db, sql, p = []) => Number((await one(db, sql, p)).n);

/** Loaded database with alpha approved and published (all gates really pass), as the reviewer would do it. */
async function publishedDb() {
  const db = await freshDatabase();
  const dir = writeMiniDataset(fs.mkdtempSync(path.join(os.tmpdir(), "takedown-test-")));
  await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  await db.query("insert into auth.users (id) values ($1), ($2)", [REVIEWER, PLAIN]);
  await db.query("insert into app_role (user_id, role) values ($1, 'reviewer')", [REVIEWER]);
  const id = (await one(db, "select id from candidate where canonical_key = $1", [KEYS.A])).id;
  await db.query(`insert into listing_draft (candidate_id, title, summary, summary_kind, summary_approved_by, summary_approved_at, content_type, install_text,
      licence, last_checked_at, evidence_level, source_links) values ($1, 'Alpha', 'Reviewer-written summary.', 'reviewer_written', $2, now(), 'server', 'not documented',
      'unknown', now(), 2, '[{"url":"https://example.org/alpha","kind":"repo"}]')`, [id, REVIEWER]);
  const res = await applyDecisions(db, [
    { canonical_key: KEYS.A, action: "clear_removal_hold", reason: "classifier hold reviewed, unrelated project" },
    { canonical_key: KEYS.A, action: "approve", reason: "individually approved" },
  ], { reviewerId: REVIEWER });
  assert.deepEqual(res.map((r) => r.error), [null, null]);
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [REVIEWER]);
  await db.query("select publish_listing($1, 'alpha')", [id]);
  await db.query("commit");
  return { db, id };
}
const visible = async (db) => num(db, "select count(*) n from public_listing where slug = 'alpha'");

test("a published listing is visible; a removal request hides it at once and blocks approval of anything else on the same candidate", async () => {
  const { db, id } = await publishedDb();
  assert.equal(await visible(db), 1);
  const tid = await recordTakedown(db, REVIEWER, { kind: "removal", ref: "alpha", contact: "owner@example.test", details: "my project" });
  assert.equal(await visible(db), 0, "hold hides the listing immediately");
  assert.equal((await one(db, "select removal_hold h, status::text s from candidate where id = $1", [id])).h, true);
  assert.equal((await one(db, "select status::text s, ownership_verified o from takedown_request where id = $1", [tid])).s, "open");
  assert.ok((await one(db, "select publication_gate_failures($1) f", [id])).f.some((f) => f.startsWith("P3")));
  assert.equal(await num(db, "select count(*) n from audit_log where action = 'record_takedown_request'"), 1);
});

test("accepting a removal needs a verified owner; then the key is suppressed, withdrawn, and a re-import cannot bring it back", async () => {
  const { db, id } = await publishedDb();
  const tid = await recordTakedown(db, REVIEWER, { kind: "removal", ref: KEYS.A.toUpperCase(), contact: "owner@example.test" });
  await assert.rejects(resolveTakedown(db, REVIEWER, tid, "accept", "owner asked"), /ownership has not been verified/);
  await assert.rejects(verifyTakedownOwnership(db, REVIEWER, tid, "  "), /basis of the ownership check is required/);
  await verifyTakedownOwnership(db, REVIEWER, tid, "write access to the repository confirmed on 2026-10-16");
  await resolveTakedown(db, REVIEWER, tid, "accept", "maintainer-verified removal request");
  const c = await one(db, "select status::text s, importable i, removal_hold h from candidate where id = $1", [id]);
  assert.deepEqual([c.s, c.i, c.h], ["withdrawn", false, true]);
  assert.equal(await num(db, "select count(*) n from suppression where takedown_id = $1", [tid]), 1);
  assert.equal(await visible(db), 0);
  const dir = writeMiniDataset(fs.mkdtempSync(path.join(os.tmpdir(), "takedown-test-")));
  await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  assert.equal(await visible(db), 0, "re-import must not resurrect it");
  assert.equal((await one(db, "select status::text s, importable i from candidate where id = $1", [id])).s, "withdrawn");
  await assert.rejects(resolveTakedown(db, REVIEWER, tid, "accept", "again"), /already accepted/);
});

test("rejecting a request leaves the hold until a reviewer clears it explicitly, which restores the listing", async () => {
  const { db, id } = await publishedDb();
  const tid = await recordTakedown(db, REVIEWER, { kind: "removal", ref: "alpha", contact: "someone@example.test" });
  await resolveTakedown(db, REVIEWER, tid, "reject", "requester is not the maintainer");
  assert.equal(await visible(db), 0, "still held after a rejection");
  const res = await applyDecisions(db, [{ canonical_key: KEYS.A, action: "clear_removal_hold", reason: "request rejected, listing stays" }], { reviewerId: REVIEWER });
  assert.equal(res[0].ok, true);
  assert.equal(await visible(db), 1);
  assert.equal((await one(db, "select status::text s from takedown_request where id = $1", [tid])).s, "rejected");
});

test("a correction request does not hide the listing but blocks new approvals until it is resolved", async () => {
  const { db, id } = await publishedDb();
  const tid = await recordTakedown(db, REVIEWER, { kind: "correction", ref: "alpha", details: "licence is wrong" });
  assert.equal(await visible(db), 1);
  assert.ok((await one(db, "select publication_gate_failures($1) f", [id])).f.some((f) => /open or accepted takedown/.test(f)));
  await resolveTakedown(db, REVIEWER, tid, "accept", "licence corrected in the draft");
  assert.equal(await visible(db), 1);
  assert.ok(!(await one(db, "select publication_gate_failures($1) f", [id])).f.some((f) => /takedown/.test(f)), "an accepted correction must not block forever");
});

test("unknown references and bad input are refused; a plain user cannot use the workflow", async () => {
  const { db } = await publishedDb();
  await assert.rejects(recordTakedown(db, REVIEWER, { kind: "removal", ref: "no-such-thing" }), /no candidate or listing matches/);
  await assert.rejects(recordTakedown(db, REVIEWER, { kind: "delete_everything", ref: "alpha" }), /unknown request kind/);
  await assert.rejects(recordTakedown(db, PLAIN, { kind: "removal", ref: "alpha" }), /reviewer role required/);
  assert.equal(await num(db, "select count(*) n from takedown_request"), 0);
  assert.equal(await visible(db), 1);
  const tid = await recordTakedown(db, REVIEWER, { kind: "removal", ref: "alpha" });
  await assert.rejects(resolveTakedown(db, PLAIN, tid, "reject", "x"), /reviewer role required/);
  await assert.rejects(resolveTakedown(db, REVIEWER, tid, "maybe", "x"), /decision must be/);
  await assert.rejects(resolveTakedown(db, REVIEWER, tid, "reject", " "), /a reason is required/);
});

test("anon and plain authenticated roles cannot execute the workflow functions or read requests", async () => {
  const { db } = await publishedDb();
  for (const fn of ["record_takedown_request(text, text, text, text)", "verify_takedown_ownership(uuid, text)", "resolve_takedown_request(uuid, text, text)"]) {
    assert.equal((await one(db, "select has_function_privilege('anon', $1, 'execute') x", [fn])).x, false, fn);
  }
  assert.equal((await one(db, "select has_table_privilege('anon', 'takedown_request', 'select') x")).x, false);
  assert.equal((await one(db, "select has_table_privilege('authenticated', 'takedown_request', 'select') x")).x, false);
});
