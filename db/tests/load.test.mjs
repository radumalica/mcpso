// Loader behaviour on a fresh PGlite database with migrations 0001-0002 applied, using the synthetic mini dataset.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDatabase } from "./run.mjs";
import { loadDataset, reconcileDatabase, readDataset, dispositionOf } from "../../tools/upstream-import/load.mjs";
import { miniDataset, writeMiniDataset, KEYS } from "../../tools/upstream-import/test/fixtures/mini-dataset.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "load-test-"));
const one = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
const num = async (db, sql, p = []) => Number((await one(db, sql, p)).n);

async function loaded() {
  const db = await freshDatabase();
  const dir = writeMiniDataset(tmp());
  const result = await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  return { db, dir, result };
}

test("every source record gets exactly one disposition and reconciliation passes", async () => {
  const { db, result } = await loaded();
  const rec = await reconcileDatabase(db, result.dataset);
  assert.deepEqual(rec.checks.filter((c) => !c.ok), []);
  assert.equal(await num(db, "select count(*) n from source_record"), 12);
  assert.equal(await num(db, "select count(*) n from source_candidate_map"), 12);
  const d = Object.fromEntries((await db.query("select disposition, count(*)::int n from source_candidate_map group by 1")).rows.map((r) => [r.disposition, r.n]));
  assert.deepEqual(d, { mapped: 4, no_identity: 2, not_submission: 1, code_contribution: 1, context_comment: 2, removal_request: 1, link_correction: 1 });
});

test("duplicate records map to one candidate; removal request points at its target; ambiguous link correction has none", async () => {
  const { db } = await loaded();
  assert.equal(await num(db, `select count(*) n from source_candidate_map m join candidate c on c.id = m.candidate_id where c.canonical_key = $1 and m.disposition = 'mapped'`, [KEYS.A]), 2);
  assert.equal(await num(db, `select count(*) n from source_candidate_map m join candidate c on c.id = m.candidate_id where m.disposition = 'removal_request' and c.canonical_key = $1`, [KEYS.A]), 1);
  assert.equal(await num(db, `select count(*) n from source_candidate_map where disposition = 'link_correction' and candidate_id is null`), 1);
  assert.equal(await num(db, `select count(*) n from source_candidate_map where method = 'dedup:unresolved'`), 1);
});

test("loading sets machine statuses, flags and holds but never approves or publishes", async () => {
  const { db } = await loaded();
  const st = Object.fromEntries((await db.query("select canonical_key k, status::text s, removal_hold h, security_flags f from candidate")).rows.map((r) => [r.k, r]));
  assert.equal(st[KEYS.A].s, "eligible");
  assert.equal(st[KEYS.A].h, true);
  assert.equal(st[KEYS.B].s, "needs_review");
  assert.deepEqual(st[KEYS.B].f, ["pipe_to_shell_install"]);
  assert.equal(st[KEYS.C].s, "ineligible");
  assert.equal(await num(db, "select count(*) n from candidate where status in ('approved','published')"), 0);
  assert.equal(await num(db, "select count(*) n from listing"), 0);
  assert.equal(await num(db, "select count(*) n from public_listing"), 0);
});

test("a removal request holds its target even when the classifier output carries no hold (fail closed)", async () => {
  const db = await freshDatabase();
  const ds = miniDataset();
  ds.classified[0].quality_indicators = []; // classifier "forgot" removal_request_pending for alpha
  const dir = writeMiniDataset(tmp(), ds);
  const r = await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  assert.equal((await one(db, "select removal_hold h from candidate where canonical_key = $1", [KEYS.A])).h, true);
  assert.equal(r.counts.removal_holds_added, 1);
  assert.deepEqual((await reconcileDatabase(db, r.dataset)).checks.filter((c) => !c.ok), []);
});

test("reconciliation flags a removal target without a hold", async () => {
  const { db, result } = await loaded();
  await db.query("update candidate set removal_hold = false where canonical_key = $1", [KEYS.A]);
  const rec = await reconcileDatabase(db, result.dataset);
  assert.ok(rec.checks.some((c) => !c.ok && /removal request without a hold/.test(c.name)));
});

test("a reload never clears a hold that a reviewer-side process set", async () => {
  const { db, dir } = await loaded();
  await db.query("update candidate set removal_hold = true where canonical_key = $1", [KEYS.C]);
  await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  assert.equal((await one(db, "select removal_hold h from candidate where canonical_key = $1", [KEYS.C])).h, true);
});

test("candidate facts contain no submitter handles", async () => {
  const { db } = await loaded();
  const facts = (await db.query("select facts from candidate")).rows.map((r) => JSON.stringify(r.facts)).join("\n");
  assert.ok(!/user\d/.test(facts) && !facts.includes("authors"));
});

test("a second load of the same files inserts nothing new", async () => {
  const { db, dir } = await loaded();
  const tables = ["source_record", "source_record_revision", "candidate", "eligibility_evaluation", "source_candidate_map"];
  const before = {};
  for (const t of tables) before[t] = await num(db, `select count(*) n from ${t}`);
  const evaluatedAt = (await db.query("select candidate_id, evaluated_at from eligibility_evaluation order by 1")).rows;
  const again = await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  for (const t of tables) assert.equal(await num(db, `select count(*) n from ${t}`), before[t], t);
  assert.equal(again.counts.inserted, 0);
  assert.equal(again.counts.unchanged, 12);
  assert.deepEqual((await db.query("select candidate_id, evaluated_at from eligibility_evaluation order by 1")).rows, evaluatedAt, "unchanged evaluations must not be rewritten");
  assert.equal(await num(db, "select count(*) n from import_batch where status = 'completed'"), 2);
});

test("an edited source record keeps its previous version as a revision", async () => {
  const { db, dir } = await loaded();
  const ds = miniDataset();
  ds.raw.issues[0] = { ...ds.raw.issues[0], body: "edited body", updated_at: "2026-02-02T00:00:00Z" };
  writeMiniDataset(dir, ds);
  const r = await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  assert.equal(r.counts.changed, 1);
  assert.equal(await num(db, "select count(*) n from source_record_revision"), 1);
  assert.equal((await one(db, "select raw->>'body' b from source_record where source_id = 101")).b, "edited body");
  assert.equal((await one(db, "select raw->>'body' b from source_record_revision")).b, "synthetic body 1");
  assert.equal(await num(db, "select count(*) n from source_record"), 12);
});

test("a re-collection that only changes collected_at is not an edit", async () => {
  const { db, dir } = await loaded();
  const ds = miniDataset();
  ds.raw.issues = ds.raw.issues.map((r) => ({ ...r, collected_at: "2027-01-01T00:00:00Z", batch_id: "batch-x" }));
  writeMiniDataset(dir, ds);
  const r = await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  assert.equal(r.counts.changed, 0);
  assert.equal(await num(db, "select count(*) n from source_record_revision"), 0);
});

test("a reviewed (approved/withdrawn) candidate is never moved by a reload", async () => {
  const { db, dir } = await loaded();
  await db.query("update candidate set status = 'eligible' where canonical_key = $1", [KEYS.A]);
  await db.query("set app.in_transition = 'on'");
  await db.query("update candidate set status = 'rejected' where canonical_key = $1", [KEYS.A]);
  await db.query("set app.in_transition = 'off'");
  await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  assert.equal((await one(db, "select status::text s from candidate where canonical_key = $1", [KEYS.A])).s, "rejected");
});

test("a suppressed key stays non-importable after a reload", async () => {
  const db = await freshDatabase();
  const dir = writeMiniDataset(tmp());
  await db.query("insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e1')");
  await db.query("insert into suppression (canonical_key, reason, created_by) values ($1, 'owner request', '00000000-0000-0000-0000-0000000000e1')", [KEYS.B]);
  await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  assert.equal((await one(db, "select importable from candidate where canonical_key = $1", [KEYS.B])).importable, false);
});

test("a failing load rolls back completely and marks the batch failed", async () => {
  const db = await freshDatabase();
  const ds = miniDataset();
  ds.projects[0].identity_type = "not_a_type"; // violates the identity_type check on candidate
  const dir = writeMiniDataset(tmp(), ds);
  await assert.rejects(loadDataset({ db, dataDir: dir, sourceRepo: "example/source" }));
  assert.equal(await num(db, "select count(*) n from source_record"), 0);
  assert.equal(await num(db, "select count(*) n from candidate"), 0);
  assert.equal((await one(db, "select status::text s from import_batch")).s, "failed");
});

test("reconciliation detects a missing disposition", async () => {
  const { db, result } = await loaded();
  await db.query("delete from source_candidate_map where disposition = 'context_comment' and ctid in (select ctid from source_candidate_map where disposition = 'context_comment' limit 1)");
  const rec = await reconcileDatabase(db, result.dataset);
  assert.equal(rec.ok, false);
  assert.ok(rec.checks.some((c) => !c.ok && /disposition/.test(c.name)));
});

test("dispositionOf covers every intent and rejects unknown ones", () => {
  for (const intent of ["submission", "submission_unclear", "no_identity", "code_contribution", "question_or_feedback", "removal_request", "link_correction"]) {
    assert.ok(dispositionOf({ intent }, null, null).disposition);
  }
  assert.throws(() => dispositionOf({ intent: "mystery" }, null, null), /unknown intent/);
});

test("readDataset reads the layout written by the pipeline", () => {
  const ds = readDataset(writeMiniDataset(tmp()));
  assert.equal(ds.raw.length, 12);
  assert.equal(ds.projects.length, 3);
});

test("blocking ambiguity flags create one manual-review group each; reloads and resolved groups are not recreated", async () => {
  const { db, dir } = await loaded();
  assert.equal(await num(db, "select count(*) n from duplicate_group where needs_manual_review and method like 'dedup:ambiguity:%'"), 1);
  await db.query("update duplicate_group set needs_manual_review = false");
  const again = await loadDataset({ db, dataDir: dir, sourceRepo: "example/source" });
  assert.equal(again.counts.ambiguity_groups_created, 0);
  assert.equal(await num(db, "select count(*) n from duplicate_group"), 1);
  assert.equal(await num(db, "select count(*) n from duplicate_group where needs_manual_review"), 0, "a resolved group stays resolved");
});

test("informational flags (monorepo subpath) do not create a group", async () => {
  const db = await freshDatabase();
  const ds = miniDataset();
  ds.classified[0].ambiguity_flags = ["monorepo_subpath_project"];
  ds.classified[2].ambiguity_flags = [{ code: "shared_package_across_repos", detail: "x" }];
  const r = await loadDataset({ db, dataDir: writeMiniDataset(tmp(), ds), sourceRepo: "example/source" });
  assert.equal(r.counts.ambiguity_groups_created, 1);
});
