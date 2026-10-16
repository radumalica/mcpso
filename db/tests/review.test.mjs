// Interim review workflow against a loaded PGlite database: queue order, sheet validation, decisions through the audited functions.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDatabase } from "./run.mjs";
import { loadDataset } from "../../tools/upstream-import/load.mjs";
import { reviewQueue, writeSheet, validateDecisions, applyDecisions, ACTIONS } from "../../tools/upstream-import/review.mjs";
import { parseCsv } from "../../tools/upstream-import/lib/csv.mjs";
import { writeMiniDataset, KEYS } from "../../tools/upstream-import/test/fixtures/mini-dataset.mjs";

const REVIEWER = "00000000-0000-0000-0000-0000000000f1";
const PLAIN = "00000000-0000-0000-0000-0000000000f2";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "review-test-"));

async function setup() {
  const db = await freshDatabase();
  await loadDataset({ db, dataDir: writeMiniDataset(tmp()), sourceRepo: "example/source" });
  await db.query("insert into auth.users (id) values ($1), ($2)", [REVIEWER, PLAIN]);
  await db.query("insert into app_role (user_id, role) values ($1, 'reviewer')", [REVIEWER]);
  return db;
}
const status = async (db, key) => (await db.query("select status::text s from candidate where canonical_key = $1", [key])).rows[0].s;
const count = async (db, sql) => Number((await db.query(sql)).rows[0].n);

test("the queue follows the review order: ambiguity, security flag, removal hold", async () => {
  const db = await setup();
  const q = await reviewQueue(db);
  assert.deepEqual(q.map((r) => [r.canonical_key, r.priority, r.queue]), [
    [KEYS.C, 1, "ambiguous group"], [KEYS.B, 2, "security flag"], [KEYS.A, 3, "removal hold"],
  ]);
  assert.equal(q[1].security_flags, "pipe_to_shell_install");
  assert.equal(q[0].ambiguity_flags, "shared_endpoint");
});

test("the sheet has blank decision columns and survives a CSV round trip", async () => {
  const db = await setup();
  const file = path.join(tmp(), "queue.csv");
  writeSheet(file, await reviewQueue(db));
  const back = parseCsv(fs.readFileSync(file, "utf8"));
  assert.equal(back.length, 3);
  assert.ok(back.every((r) => r.decision === "" && r.reason === ""));
  assert.equal(back[0].canonical_key, KEYS.C);
});

test("validation: blank rows skipped; unknown action, publish, missing reason and duplicates refused", () => {
  const sheet = [
    { canonical_key: "a", decision: "", reason: "" },
    { canonical_key: "b", decision: "reject", reason: "not an MCP server" },
    { canonical_key: "c", decision: "publish", reason: "go" },
    { canonical_key: "d", decision: "approve", reason: " " },
    { canonical_key: "e", decision: "bulk_approve", reason: "x" },
    { canonical_key: "b", decision: "reject", reason: "again" },
  ];
  const { rows, errors } = validateDecisions(sheet);
  assert.deepEqual(rows.map((r) => r.canonical_key), ["b", "b"]);
  assert.equal(errors.length, 4);
  assert.ok(errors.some((e) => /"publish" is not allowed/.test(e)));
  assert.ok(errors.some((e) => /reason is required/.test(e)));
  assert.ok(errors.some((e) => /duplicate reject/.test(e)));
  assert.ok(!ACTIONS.includes("publish"));
});

test("a rejection is applied through the audited function; a gated approval is refused without blocking the rest", async () => {
  const db = await setup();
  const res = await applyDecisions(db, [
    { canonical_key: KEYS.A, action: "approve", reason: "looks fine" },     // gates: removal hold, no listing draft
    { canonical_key: KEYS.C, action: "reject", reason: "endpoint is not an MCP server" },
  ], { reviewerId: REVIEWER });
  assert.deepEqual(res.map((r) => r.ok), [false, true]);
  assert.match(res[0].error, /approval blocked by gates/);
  assert.match(res[0].error, /P3 removal hold/);
  assert.equal(await status(db, KEYS.A), "eligible");
  assert.equal(await status(db, KEYS.C), "rejected");
  assert.equal(await count(db, "select count(*) n from review_decision where action = 'reject'"), 1);
  assert.equal(await count(db, "select count(*) n from audit_log where action = 'reject'"), 1);
  assert.equal((await db.query("select reviewer_id::text r from review_decision")).rows[0].r, REVIEWER);
});

test("a user without the reviewer role cannot change anything", async () => {
  const db = await setup();
  const res = await applyDecisions(db, [{ canonical_key: KEYS.C, action: "reject", reason: "no" }], { reviewerId: PLAIN });
  assert.equal(res[0].ok, false);
  assert.match(res[0].error, /reviewer role required/);
  assert.equal(await status(db, KEYS.C), "ineligible");
  assert.equal(await count(db, "select count(*) n from review_decision"), 0);
});

test("a dry run reports the outcome and changes nothing", async () => {
  const db = await setup();
  const res = await applyDecisions(db, [{ canonical_key: KEYS.C, action: "reject", reason: "dry" }], { reviewerId: REVIEWER, dryRun: true });
  assert.equal(res[0].ok, true);
  assert.equal(await status(db, KEYS.C), "ineligible");
  assert.equal(await count(db, "select count(*) n from review_decision"), 0);
});

test("clearing a removal hold and a security flag are individual, reasoned and audited", async () => {
  const db = await setup();
  const res = await applyDecisions(db, [
    { canonical_key: KEYS.A, action: "clear_removal_hold", reason: "requester confirmed it was a different project" },
    { canonical_key: KEYS.B, action: "clear_security_flag", reason: "install snippet inspected by hand" },
  ], { reviewerId: REVIEWER });
  assert.deepEqual(res.map((r) => r.ok), [true, true]);
  assert.equal((await db.query("select removal_hold h from candidate where canonical_key = $1", [KEYS.A])).rows[0].h, false);
  assert.ok((await db.query("select security_cleared_at c from candidate where canonical_key = $1", [KEYS.B])).rows[0].c);
  assert.equal(await count(db, "select count(*) n from audit_log where action in ('clear_removal_hold','clear_security_flag')"), 2);
});

test("suppression through the sheet removes the key from future imports", async () => {
  const db = await setup();
  const res = await applyDecisions(db, [{ canonical_key: KEYS.B, action: "suppress", reason: "owner removal request" }], { reviewerId: REVIEWER });
  assert.equal(res[0].ok, true);
  assert.equal(await status(db, KEYS.B), "rejected");
  assert.equal((await db.query("select importable i from candidate where canonical_key = $1", [KEYS.B])).rows[0].i, false);
  assert.equal(await count(db, "select count(*) n from suppression"), 1);
});

test("unknown candidates are reported, and an empty reviewer id is refused", async () => {
  const db = await setup();
  const res = await applyDecisions(db, [{ canonical_key: "github.com/none/none", action: "reject", reason: "x" }], { reviewerId: REVIEWER });
  assert.deepEqual([res[0].ok, res[0].error], [false, "unknown candidate"]);
  await assert.rejects(applyDecisions(db, [], {}), /reviewerId is required/);
});

test("decided candidates leave the queue", async () => {
  const db = await setup();
  await applyDecisions(db, [{ canonical_key: KEYS.C, action: "reject", reason: "not a server" }], { reviewerId: REVIEWER });
  assert.deepEqual((await reviewQueue(db)).map((r) => r.canonical_key), [KEYS.B, KEYS.A]);
});
