// Migration 0007: fixes for the findings of the independent database review, each proven by a failing-before / passing-after scenario.
import test from "node:test";
import assert from "node:assert/strict";
import { loadDataset } from "../../tools/upstream-import/load.mjs";
import { applyDecisions } from "../../tools/upstream-import/review.mjs";
import { REVIEWER, PLAIN, KEYS, one, num, loadedDb, publishedDb, asRole } from "./helpers.mjs";

test("a temporary table cannot shadow app_role: a plain user never becomes a reviewer", async () => {
  const { db } = await loadedDb();
  await asRole(db, "authenticated", PLAIN, async () => {
    try {
      await db.query("create temp table app_role (user_id uuid, role text)");
      await db.query("insert into app_role values ($1, 'reviewer')", [PLAIN]);
    } catch { /* temp tables may be refused outright, which is also fine */ }
    assert.equal((await one(db, "select is_reviewer() r")).r, false);
    await assert.rejects(db.query("select review_candidate(gen_random_uuid(), 'reject', 'x')"), /reviewer role required|permission denied/);
  });
});

test("every security definer function pins search_path with pg_temp last", async () => {
  const { db } = await loadedDb();
  const bad = (await db.query(`select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and not (coalesce(p.proconfig, '{}')::text[] && array['search_path=public, pg_temp'])`)).rows;
  assert.deepEqual(bad, []);
});

test("anon can read the public view when a published row exists (is_suppressed runs as its owner)", async () => {
  const { db } = await publishedDb();
  const rows = await asRole(db, "anon", null, async () => (await db.query("select slug from public_listing")).rows);
  assert.deepEqual(rows.map((r) => r.slug), ["alpha"]);
  await asRole(db, "anon", null, async () => {
    await assert.rejects(db.query("select * from suppression"), /permission denied/);
    await assert.rejects(db.query("select publication_gate_failures(gen_random_uuid())"), /permission denied/);
  });
});

test("suppressing a merged ('duplicate') candidate works and keeps the merge", async () => {
  const { db } = await loadedDb();
  const [a, b] = await Promise.all([KEYS.A, KEYS.B].map(async (k) => (await one(db, "select id from candidate where canonical_key = $1", [k])).id));
  await db.query("update candidate set status = 'duplicate', merged_into = $1 where id = $2", [a, b]);
  const r = await applyDecisions(db, [{ canonical_key: KEYS.B, action: "suppress", reason: "owner removal request" }], { reviewerId: REVIEWER });
  assert.equal(r[0].error, null);
  const c = await one(db, "select status::text s, importable i, merged_into m from candidate where id = $1", [b]);
  assert.deepEqual([c.s, c.i, c.m], ["duplicate", false, a]);
  assert.equal(await num(db, "select count(*) n from suppression"), 1);
});

test("suppressing a candidate whose listing was already withdrawn works", async () => {
  const { db, id } = await publishedDb();
  const un = await applyDecisions(db, [{ canonical_key: KEYS.A, action: "unpublish", reason: "owner asked" }], { reviewerId: REVIEWER });
  assert.equal(un[0].error, null);
  const r = await applyDecisions(db, [{ canonical_key: KEYS.A, action: "suppress", reason: "removal confirmed" }], { reviewerId: REVIEWER });
  assert.equal(r[0].error, null);
  assert.equal((await one(db, "select importable i from candidate where id = $1", [id])).i, false);
});

test("an import under a suppressed key withdraws a published candidate instead of failing", async () => {
  const { db, id } = await publishedDb();
  await db.query("insert into suppression (canonical_key, reason, created_by) values ($1, 'owner request', $2)", [KEYS.A, REVIEWER]);
  const batch = (await one(db, "select id from import_batch limit 1")).id;
  await db.query("select import_upsert_candidate($1, 'github_repo', '{}'::jsonb, $2)", [KEYS.A, batch]);
  const c = await one(db, "select status::text s, importable i, removal_hold h from candidate where id = $1", [id]);
  assert.deepEqual([c.s, c.i, c.h], ["withdrawn", false, true]);
  assert.equal(await num(db, "select count(*) n from public_listing"), 0);
});

test("the importer role has only importer rights and cannot bypass the gates", async () => {
  const { db, id } = await publishedDb();
  const denied = async (sql, p = []) => assert.rejects(db.query(sql, p), /permission denied|can only be set by|violates/i, sql);
  await asRole(db, "service_role", null, async () => {
    await denied("insert into candidate (canonical_key, identity_type, status) values ('github.com/x/y', 'github_repo', 'published')");
    await denied("insert into candidate (canonical_key, identity_type, status) values ('github.com/x/z', 'github_repo', 'approved')");
    await denied("update candidate set status = 'published' where canonical_key = $1", [KEYS.B]);
    await denied("update candidate set security_cleared_at = now(), security_cleared_by = $1 where canonical_key = $2", [REVIEWER, KEYS.B]);
    await denied("update candidate set override_reason = 'x' where id = $1", [id]);
    await denied("update candidate set merged_into = id");
    await denied("insert into listing (candidate_id, slug, title, summary, facts, source_links, published_by) values ($1, 'x', 'x', 'x', '{}', '[]', $2)", [id, REVIEWER]);
    await denied("update listing_draft set summary_approved_by = $1", [REVIEWER]);
    await denied("delete from suppression");
    await denied("insert into suppression (canonical_key, reason, created_by) values ('k', 'r', $1)", [REVIEWER]);
    await denied("insert into review_decision (candidate_id, action, from_status, to_status, reason, reviewer_id) values ($1, 'approve', 'eligible', 'approved', 'x', $2)", [id, REVIEWER]);
    await denied("select * from audit_log");
    await denied("update app_role set role = 'admin'");
    // what it needs is still allowed
    await db.query("select import_upsert_candidate('github.com/ok/ok', 'github_repo', '{}'::jsonb, (select id from import_batch limit 1))");
    await db.query("update candidate set name = 'renamed', updated_at = now() where canonical_key = 'github.com/ok/ok'");
  });
});

test("the whole loader runs with only the importer role's privileges", async () => {
  const { db, dir } = await loadedDb();
  const before = await num(db, "select count(*) n from source_record");
  const r = await asRole(db, "service_role", null, () => loadDataset({ db, dataDir: dir, sourceRepo: "example/source" }));
  assert.equal(r.counts.inserted, 0);
  assert.equal(await num(db, "select count(*) n from source_record"), before);
  const fresh = await (async () => {
    const { freshDatabase } = await import("./run.mjs");
    const d2 = await freshDatabase();
    const rr = await asRole(d2, "service_role", null, () => loadDataset({ db: d2, dataDir: dir, sourceRepo: "example/source" }));
    return rr.counts;
  })();
  assert.equal(fresh.inserted, 12, "a first load works under the importer role too");
  assert.ok(fresh.ambiguity_groups_created >= 1);
});

test("undo_bulk_action reverts only still-approved candidates, records each revert, and refuses unknown or reasonless calls", async () => {
  const { db, id } = await publishedDb();
  // a bulk approval of candidate C (level 2 draft prepared by hand), then B stays untouched
  const c = (await one(db, "select id from candidate where canonical_key = $1", [KEYS.C])).id;
  await db.query(`insert into listing_draft (candidate_id, title, summary, summary_kind, summary_approved_by, summary_approved_at, content_type, install_text,
      licence, last_checked_at, evidence_level, source_links) values ($1, 'C', 's', 'template', $2, now(), 'server', 'x', 'MIT', now(), 2, '[{"url":"https://e.test"}]')`, [c, REVIEWER]);
  await db.query("update candidate set status = 'eligible' where id = $1", [c]);
  await db.query("update eligibility_evaluation set category = 'eligible' where candidate_id = $1", [c]);
  await db.query("update duplicate_group set needs_manual_review = false");
  await db.query("begin");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [REVIEWER]);
  const bulk = (await one(db, "select apply_bulk_approval(array[$1::uuid], 1, '{}'::jsonb) b", [c])).b;
  await db.query("commit");
  assert.equal((await one(db, "select status::text s from candidate where id = $1", [c])).s, "approved");
  const undo = async (b, reason) => {
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [REVIEWER]);
      await db.query("select undo_bulk_action($1::uuid, $2)", [b, reason]);
      await db.query("commit");
    } catch (e) { await db.query("rollback"); throw e; }
  };
  await assert.rejects(undo("00000000-0000-0000-0000-00000000dead", "x"), /unknown bulk action/);
  await assert.rejects(undo(bulk, " "), /a reason is required/);
  // the candidate is rejected after the bulk approval: undo must not overwrite that decision
  await applyDecisions(db, [{ canonical_key: KEYS.C, action: "reject", reason: "later review: not a server" }], { reviewerId: REVIEWER });
  await undo(bulk, "bulk scope was wrong");
  assert.equal((await one(db, "select status::text s from candidate where id = $1", [c])).s, "rejected");
  assert.equal(await num(db, "select count(*) n from review_decision where candidate_id = $1 and reason like 'bulk action undone%'", [c]), 0);
  assert.equal((await one(db, "select (after->>'reverted')::int r, (after->>'in_bulk')::int t from audit_log where action = 'undo_bulk_action'")).r, 0);
  assert.equal((await one(db, "select status::text s from candidate where id = $1", [id])).s, "published", "unrelated published candidate untouched");
  await assert.rejects(undo(bulk, "again"), /already undone/);
});

test("a draft summary containing a forbidden trust word is rejected, whichever way it is written", async () => {
  const { db, id } = await publishedDb();
  const b = (await one(db, "select id from candidate where canonical_key = $1", [KEYS.B])).id;
  for (const bad of ["A verified server.", "Safe to run.", "This is SECURE.", "Trusted by many.", "Our recommended pick."]) {
    await assert.rejects(db.query("insert into listing_draft (candidate_id, title, summary, summary_kind, content_type, install_text, licence, last_checked_at, evidence_level, source_links) values ($1, $4, $2, $3, $5, $6, $7, now(), 1, $8)", [b, bad, "reviewer_written", "t", "server", "x", "MIT", "[]"]), /wording policy/, bad);
  }
  await db.query("insert into listing_draft (candidate_id, title, summary, summary_kind, content_type, install_text, licence, last_checked_at, evidence_level, source_links) values ($1, $4, $2, $3, $5, $6, $7, now(), 1, $8)", [b, "Reviewed for security by nobody; a plain description.", "reviewer_written", "t", "server", "x", "MIT", "[]"]);
  assert.equal(await num(db, "select count(*) n from listing_draft where candidate_id = $1", [b]), 1);
  await assert.rejects(db.query("update listing_draft set summary = $2 where candidate_id = $1", [id, "now verified"]), /wording policy/);
});

test("clients cannot call is_suppressed directly (it would reveal takedown subjects) but the public view still works", async () => {
  const { db } = await publishedDb();
  for (const role of ["anon", "authenticated"]) {
    await asRole(db, role, null, async () => {
      await assert.rejects(db.query("select is_suppressed($1)", [KEYS.A]), /permission denied/);
      assert.equal((await db.query("select slug from public_listing")).rows.length, 1);
    });
  }
});
