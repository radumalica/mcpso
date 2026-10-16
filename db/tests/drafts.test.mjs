// Listing drafts, summary approval and publication (migration 0006) from the loaded synthetic dataset to a visible public entry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDatabase } from "./run.mjs";
import { loadDataset } from "../../tools/upstream-import/load.mjs";
import { applyDecisions, prepareDrafts, approveSummaries, publishApproved } from "../../tools/upstream-import/review.mjs";
import { writeMiniDataset, KEYS } from "../../tools/upstream-import/test/fixtures/mini-dataset.mjs";

const REVIEWER = "00000000-0000-0000-0000-0000000000f1";
const PLAIN = "00000000-0000-0000-0000-0000000000f2";
const one = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
const num = async (db, sql, p = []) => Number((await one(db, sql, p)).n);

async function setup() {
  const db = await freshDatabase();
  await loadDataset({ db, dataDir: writeMiniDataset(fs.mkdtempSync(path.join(os.tmpdir(), "drafts-test-"))), sourceRepo: "example/source" });
  await db.query("insert into auth.users (id) values ($1), ($2)", [REVIEWER, PLAIN]);
  await db.query("insert into app_role (user_id, role) values ($1, 'reviewer')", [REVIEWER]);
  return db;
}
const gates = async (db, key) => (await one(db, "select publication_gate_failures(id) f from candidate where canonical_key = $1", [key])).f;

test("drafts are built from facts with the real retrieval date; candidates without a trustworthy date are skipped and reported", async () => {
  const db = await setup();
  const r = await prepareDrafts(db, REVIEWER, { keys: [KEYS.A, KEYS.B, KEYS.C] });
  assert.deepEqual(r.saved.sort(), [KEYS.A, KEYS.C].sort());
  assert.deepEqual(r.skipped, [{ key: KEYS.B, reason: "no repository retrieval date" }]);
  const a = await one(db, "select d.*, c.canonical_key from listing_draft d join candidate c on c.id = d.candidate_id where c.canonical_key = $1", [KEYS.A]);
  assert.equal(a.title, "Synthetic/alpha");
  assert.equal(a.summary_kind, "template");
  assert.equal(a.evidence_level, 2);
  assert.equal(a.summary_approved_by, null, "a template draft is never pre-approved");
  assert.equal(new Date(a.last_checked_at).toISOString(), "2026-10-01T00:00:00.000Z");
  const c = await one(db, "select d.evidence_level, d.content_type from listing_draft d join candidate c on c.id = d.candidate_id where c.canonical_key = $1", [KEYS.C]);
  assert.deepEqual([c.evidence_level, c.content_type], [0, "unknown"]);
  assert.equal(await num(db, "select count(*) n from audit_log where action = 'save_listing_draft'"), 2);
});

test("gate P6 holds until a person approves the summary; changing the text withdraws the approval", async () => {
  const db = await setup();
  await prepareDrafts(db, REVIEWER, { keys: [KEYS.A] });
  assert.ok((await gates(db, KEYS.A)).some((g) => g.startsWith("P6")));
  assert.equal(await approveSummaries(db, REVIEWER, [KEYS.A], "read a sample of 20 template summaries; text is factual"), 1);
  assert.ok(!(await gates(db, KEYS.A)).some((g) => g.startsWith("P6")));
  const id = (await one(db, "select id from candidate where canonical_key = $1", [KEYS.A])).id;
  const d = (await one(db, "select to_jsonb(d) j from listing_draft d where candidate_id = $1", [id])).j;
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [REVIEWER]);
  await db.query("select save_listing_draft($1::uuid, $2::jsonb)", [id, JSON.stringify({ ...d, summary: "Edited text." })]);
  await db.query("commit");
  assert.ok((await gates(db, KEYS.A)).some((g) => g.startsWith("P6")), "edited text must be approved again");
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [REVIEWER]);
  await db.query("select save_listing_draft($1::uuid, $2::jsonb)", [id, JSON.stringify({ ...d, summary: "Edited text.", title: "New title" })]);
  await db.query("commit");
  assert.equal((await one(db, "select title t from listing_draft where candidate_id = $1", [id])).t, "New title");
});

test("approval rules: a reason, 1..200 candidates, a draft with text, reviewer-written one at a time, reviewers only", async () => {
  const db = await setup();
  await prepareDrafts(db, REVIEWER, { keys: [KEYS.A, KEYS.C] });
  await assert.rejects(approveSummaries(db, REVIEWER, [KEYS.A], " "), /a reason is required/);
  await assert.rejects(approveSummaries(db, REVIEWER, [], "x"), /unknown candidate in the list|between 1 and 200/);
  await assert.rejects(approveSummaries(db, REVIEWER, [KEYS.B], "x"), /every candidate needs a draft/);
  await assert.rejects(approveSummaries(db, PLAIN, [KEYS.A], "x"), /reviewer role required/);
  await assert.rejects(approveSummaries(db, REVIEWER, ["github.com/none/none"], "x"), /unknown candidate/);
  await db.query("update listing_draft set summary_kind = 'reviewer_written'");
  await assert.rejects(approveSummaries(db, REVIEWER, [KEYS.A, KEYS.C], "x"), /one at a time/);
  assert.equal(await approveSummaries(db, REVIEWER, [KEYS.A], "written by me"), 1);
  assert.equal(await num(db, "select count(*) n from audit_log where action = 'approve_listing_summaries'"), 1);
});

test("a draft goes from template to a visible public entry only through approval, gates and an explicit launch confirmation", async () => {
  const db = await setup();
  await prepareDrafts(db, REVIEWER, { keys: [KEYS.A] });
  await approveSummaries(db, REVIEWER, [KEYS.A], "sample read");
  const blocked = await applyDecisions(db, [{ canonical_key: KEYS.A, action: "approve", reason: "individually approved" }], { reviewerId: REVIEWER });
  assert.match(blocked[0].error, /P3 removal hold/, "the classifier's removal hold still blocks");
  const res = await applyDecisions(db, [
    { canonical_key: KEYS.A, action: "clear_removal_hold", reason: "hold concerned another project" },
    { canonical_key: KEYS.A, action: "approve", reason: "individually approved" },
  ], { reviewerId: REVIEWER });
  assert.deepEqual(res.map((r) => r.error), [null, null]);
  await assert.rejects(publishApproved(db, REVIEWER, KEYS.A), /launch gates/);
  await assert.rejects(publishApproved(db, REVIEWER, KEYS.A, { launchGatesPassed: "yes" }), /launch gates/);
  assert.equal(await num(db, "select count(*) n from public_listing"), 0);
  await publishApproved(db, REVIEWER, KEYS.A, { launchGatesPassed: true });
  const l = await one(db, "select * from public_listing");
  assert.equal(l.slug, "synthetic-alpha");
  assert.equal(l.title, "Synthetic/alpha");
  assert.equal(l.evidence_level, 2);
  assert.equal(new Date(l.evidence_checked_at).toISOString().slice(0, 10), "2026-10-01");
  assert.match(l.summary, /public GitHub repository that has been listed as a Model Context Protocol server/);
  assert.ok(!JSON.stringify(l).includes("user1"), "no submitter handle in the public row");
  assert.equal(l.facts.repo.name_with_owner, "Synthetic/alpha");
  await assert.rejects(db.query("select save_listing_draft(id, '{}'::jsonb) from candidate where canonical_key = $1", [KEYS.A]), /reviewer role required|cannot be edited/);
});

test("a slug collision falls back to a suffixed slug", async () => {
  const db = await setup();
  const batch = (await one(db, "select id from import_batch limit 1")).id;
  const twinKey = "github.com/other/alpha-twin";
  await db.query("select import_upsert_candidate($1, 'github_repo', $2::jsonb, $3::uuid)", [twinKey, JSON.stringify({
    repo_url: "https://example.test/twin", repo: { name_with_owner: "Synthetic/alpha", archived: false, fork: false, license: "MIT", pushed_at: "2026-01-01T00:00:00Z", checked_at: "2026-10-02T00:00:00Z" },
  }), batch]);
  await db.query("update candidate set status = 'eligible' where canonical_key = $1", [twinKey]);
  await db.query(`insert into eligibility_evaluation (candidate_id, evaluator_version, category, reasons, evidence, quality_indicators, security_concern)
    select id, 't', 'eligible', '[]', '{"evidence_level":2}', '{}', false from candidate where canonical_key = $1`, [twinKey]);
  for (const key of [KEYS.A, twinKey]) {
    await prepareDrafts(db, REVIEWER, { keys: [key] });
    await approveSummaries(db, REVIEWER, [key], "sample read");
  }
  await applyDecisions(db, [
    { canonical_key: KEYS.A, action: "clear_removal_hold", reason: "unrelated hold" },
    { canonical_key: KEYS.A, action: "approve", reason: "ok" },
    { canonical_key: twinKey, action: "approve", reason: "ok" },
  ], { reviewerId: REVIEWER });
  await publishApproved(db, REVIEWER, KEYS.A, { launchGatesPassed: true });
  await publishApproved(db, REVIEWER, twinKey, { launchGatesPassed: true });
  const slugs = (await db.query("select slug from public_listing order by slug")).rows.map((r) => r.slug);
  assert.equal(slugs.length, 2);
  assert.equal(slugs[0], "synthetic-alpha");
  assert.match(slugs[1], /^synthetic-alpha-[0-9a-f]{7}$/);
});

test("anon and plain authenticated roles cannot run the draft functions", async () => {
  const db = await setup();
  for (const fn of ["save_listing_draft(uuid, jsonb)", "approve_listing_summaries(uuid[], text)"]) {
    assert.equal((await one(db, "select has_function_privilege('anon', $1, 'execute') x", [fn])).x, false, fn);
  }
  assert.equal((await one(db, "select has_table_privilege('authenticated', 'listing_draft', 'select') x")).x, false);
});
