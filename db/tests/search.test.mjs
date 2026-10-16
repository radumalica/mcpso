// Search indexes (migration 0005): they exist, the catalogue query can use them, and results match what the application expects.
import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./run.mjs";

const REVIEWER = "00000000-0000-0000-0000-0000000000f1";

async function dbWithListings(n = 400) {
  const db = await freshDatabase();
  await db.query("insert into auth.users (id) values ($1)", [REVIEWER]);
  await db.query("insert into import_batch (id, source_repo, mode, tool_version) values ('33333333-3333-3333-3333-333333333333', 'x/y', 'full', 't')");
  // Listings are inserted with the guard disabled: this test is about index use, not the publication boundary.
  await db.query("select set_config('app.in_transition', 'on', false)");
  await db.query("alter table listing disable trigger listing_guard");
  for (let i = 0; i < n; i++) {
    const c = (await db.query(`insert into candidate (canonical_key, identity_type, status, created_batch_id) values ($1, 'github_repo', 'published', '33333333-3333-3333-3333-333333333333') returning id`, [`github.com/t/r${i}`])).rows[0];
    await db.query(`insert into listing (candidate_id, slug, title, summary, facts, source_links, published_by) values ($1, $2, $3, $4, '{}', '[]', $5)`,
      [c.id, `s-${i}`, i === 7 ? "Needle Server" : `Server number ${i}`, i === 9 ? "finds NEEDLES in haystacks" : `Generic summary ${i}`, REVIEWER]);
  }
  await db.query("analyze listing");
  return db;
}

test("the search and review-queue indexes exist", async () => {
  const db = await freshDatabase();
  const names = (await db.query("select indexname from pg_indexes where schemaname = 'public'")).rows.map((r) => r.indexname);
  for (const n of ["listing_title_trgm", "listing_summary_trgm", "listing_visible_title", "evaluation_lane", "candidate_review_queue"]) assert.ok(names.includes(n), n);
});

test("the catalogue ilike query can use the trigram indexes", async () => {
  const db = await dbWithListings();
  await db.query("set enable_seqscan = off");
  const plan = (await db.query("explain select slug from listing where title ilike '%needle%' or summary ilike '%needle%'")).rows.map((r) => r["QUERY PLAN"]).join("\n");
  assert.match(plan, /listing_(title|summary)_trgm/, plan);
});

test("ilike through the public view finds title and summary matches, case-insensitively, and nothing for no match", async () => {
  const db = await dbWithListings(40);
  await db.query("update candidate set importable = true");
  const hit = (await db.query("select slug from public_listing where title ilike '%needle%' or summary ilike '%needle%' order by slug")).rows.map((r) => r.slug);
  assert.deepEqual(hit, ["s-7", "s-9"]);
  assert.equal((await db.query("select slug from public_listing where title ilike '%zzzzqqq%'")).rows.length, 0);
});
