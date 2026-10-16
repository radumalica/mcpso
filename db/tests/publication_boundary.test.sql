-- publication_boundary.test.sql
-- DRAFT, NEVER EXECUTED (no PostgreSQL server was available). Run against a disposable empty database after migrations 0001-0002,
-- as a superuser/owner session; each block raises on failure. Intended to run in CI (see reports/import-test-strategy-and-acceptance.md).
-- Conventions: request.jwt.claim.sub simulates auth.uid(); app_role rows grant the reviewer role.

begin;

-- ---- fixtures
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');
insert into app_role (user_id, role) values ('00000000-0000-0000-0000-0000000000a1', 'reviewer');   -- b2 is a plain user
insert into import_batch (id, source_repo, mode, tool_version) values ('11111111-1111-1111-1111-111111111111', 'chatmcp/mcpso', 'full', 'test');

create or replace function _expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(lower(needle) in lower(sqlerrm)) = 0 then raise exception 'wrong error for [%]: %', sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected an error for [%] but it succeeded', sql;
end $$;

create or replace function _mk(p_key text, p_flags text[] default '{}', p_level smallint default 2) returns uuid language plpgsql as $$
declare cid uuid;
begin
  cid := import_upsert_candidate(p_key, 'github_repo', '{}'::jsonb, '11111111-1111-1111-1111-111111111111');
  update candidate set status = 'eligible', security_flags = p_flags where id = cid;
  insert into eligibility_evaluation (candidate_id, evaluator_version, category, reasons, evidence) values (cid, 't', 'eligible', '[]', '{}');
  insert into listing_draft (candidate_id, title, summary, summary_kind, summary_approved_by, summary_approved_at, content_type, install_text, licence, last_checked_at, evidence_level, source_links)
    values (cid, p_key, 'template summary', 'template', '00000000-0000-0000-0000-0000000000a1', now(), 'server', 'not documented', 'unknown', now(), p_level, '[{"url":"x"}]');
  return cid;
end $$;

-- ---- 1. importing never approves or publishes, and re-importing never changes status
do $$ declare a uuid; b uuid; begin
  a := _mk('github.com/t/one');
  b := import_upsert_candidate('github.com/t/one', 'github_repo', '{"x":1}', '11111111-1111-1111-1111-111111111111');
  assert a = b, 'upsert must be idempotent';
  assert (select status from candidate where id = a) = 'eligible', 'import must not change status';
  assert (select count(*) from candidate where status in ('approved','published')) = 0, 'import must never approve or publish';
end $$;

-- ---- 2. status approved/published cannot be written directly, and listing rows cannot be inserted directly
do $$ declare a uuid := (select id from candidate where canonical_key = 'github.com/t/one'); begin
  perform _expect_error(format('update candidate set status = ''published'' where id = %L', a), 'transition functions');
  perform _expect_error(format('update candidate set status = ''approved'' where id = %L', a), 'transition functions');
  perform _expect_error(format('insert into listing (candidate_id, slug, title, summary, facts, source_links, published_by) values (%L, ''s'', ''t'', ''s'', ''{}'', ''[]'', %L)', a, '00000000-0000-0000-0000-0000000000a1'), 'listing requires an approved candidate');
end $$;

-- ---- 3. non-reviewers cannot transition
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$ declare a uuid := (select id from candidate where canonical_key = 'github.com/t/one'); begin
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''x'')', a), 'reviewer role required');
end $$;

-- ---- 4. reviewer: gates block approval (security flag, removal hold, suppression, rights, summary)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$ declare s uuid; h uuid; r uuid; u uuid; ok uuid; begin
  s := _mk('github.com/t/sec', array['pipe_to_shell_install']);
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', s), 'P2');
  perform clear_security_flag(s, 'documented install reviewed by hand');
  perform review_candidate(s, 'approve', 'security flag individually cleared');
  assert (select status from candidate where id = s) = 'approved';

  h := _mk('github.com/t/hold'); update candidate set removal_hold = true where id = h;
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', h), 'P3');

  insert into suppression (canonical_key, reason, created_by) values ('github.com/t/sup', 'owner request', '00000000-0000-0000-0000-0000000000a1');
  u := _mk('github.com/t/sup');
  assert (select importable from candidate where id = u) = false, 'suppressed key must import as not importable';
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', u), 'P3');

  r := _mk('github.com/t/rights'); update listing_draft set rights_flags = '{"third_party_media": true}' where candidate_id = r;
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', r), 'P7');

  ok := _mk('github.com/t/nosummary'); update listing_draft set summary_approved_by = null where candidate_id = ok;
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', ok), 'P6');
end $$;

-- ---- 5. publish only from approved; the public view shows it; audit trail exists
do $$ declare s uuid := (select id from candidate where canonical_key = 'github.com/t/sec'); begin
  perform publish_listing(s, 'sec-server');
  assert (select status from candidate where id = s) = 'published';
  assert exists (select 1 from public_listing where slug = 'sec-server'), 'published listing must be visible';
  assert (select count(*) from audit_log where entity_id = s::text) >= 3, 'transitions must be audited';
  assert (select count(*) from review_decision where candidate_id = s) >= 2;
end $$;

-- ---- 6. unpublish and suppression take the listing off the public view; re-import cannot resurrect
do $$ declare s uuid := (select id from candidate where canonical_key = 'github.com/t/sec'); rm uuid; sub uuid; begin
  perform review_candidate(s, 'unpublish', 'owner asked for removal');
  assert not exists (select 1 from public_listing where slug = 'sec-server'), 'unpublished listing must leave the public view';
  assert (select unpublished_at from listing where candidate_id = s) is not null, 'unpublish must set unpublished_at';
  perform _expect_error(format('update listing set title = ''x'', unpublished_at = null where candidate_id = %L', s), 'requires an approved');

  -- suppression of a PUBLISHED listing: one call suppresses, withdraws and removes it from the view
  rm := _mk('github.com/t/removeme');
  perform review_candidate(rm, 'approve', 'ok'); perform publish_listing(rm, 'removeme');
  assert exists (select 1 from public_listing where slug = 'removeme');
  perform suppress_candidate(rm, 'owner request');
  assert not exists (select 1 from public_listing where slug = 'removeme'), 'suppressed listing must leave the public view';
  assert (select status from candidate where id = rm) = 'withdrawn' and (select importable from candidate where id = rm) = false;
  perform import_upsert_candidate('github.com/t/removeme', 'github_repo', '{}', '11111111-1111-1111-1111-111111111111');
  assert (select status from candidate where id = rm) = 'withdrawn', 're-import must not change status';
  assert (select importable from candidate where id = rm) = false, 're-import must keep the key non-importable';
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''again'')', rm), 'P3');

  -- suppression matching: case-insensitive, and a repository suppression covers its subpaths
  insert into suppression (canonical_key, reason, created_by) values ('GitHub.com/T/Whole', 'owner request', '00000000-0000-0000-0000-0000000000a1');
  sub := _mk('github.com/t/whole/pkg/a');
  assert (select importable from candidate where id = sub) = false, 'subpath of a suppressed repository must import as not importable';
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', sub), 'P3');
end $$;

-- ---- 6b. takedown requests block approval whether open or accepted, and whether they reference the candidate or only its listing
do $$ declare t1 uuid; t2 uuid; lid uuid; begin
  t1 := _mk('github.com/t/takedown-open');
  insert into takedown_request (kind, candidate_id, status) values ('removal', t1, 'open');
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', t1), 'P3');
  update takedown_request set status = 'accepted' where candidate_id = t1;
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', t1), 'P3');   -- accepted still blocks
  update takedown_request set status = 'rejected' where candidate_id = t1;
  perform review_candidate(t1, 'approve', 'takedown rejected, reviewed');

  t2 := _mk('github.com/t/takedown-listing');
  perform review_candidate(t2, 'approve', 'ok'); lid := publish_listing(t2, 'td-listing');
  insert into takedown_request (kind, listing_id, status) values ('rights_complaint', lid, 'open');   -- references only the listing
  perform review_candidate(t2, 'unpublish', 'complaint');
  perform review_candidate(t2, 'reopen', 'reconsider');
  perform _expect_error(format('select review_candidate(%L, ''approve'', ''try'')', t2), 'P3');
end $$;

-- ---- 7. bulk approval: bounded, count-checked, excludes flagged/held/declared-only, undoable
do $$ declare ids uuid[]; b uuid; flagged uuid; declared uuid; begin
  select array_agg(_mk('github.com/t/bulk' || g)) into ids from generate_series(1, 5) g;
  perform _expect_error(format('select apply_bulk_approval(%L::uuid[], 4, ''{}'')', ids), 'differs from previewed');
  perform _expect_error('select apply_bulk_approval(array[]::uuid[], 0, ''{}'')', 'bulk scope');
  flagged := _mk('github.com/t/bulkflag', array['hidden_unicode_characters']);
  perform _expect_error(format('select apply_bulk_approval(%L::uuid[], 6, ''{}'')', ids || flagged), 'not eligible for bulk approval');
  declared := _mk('github.com/t/bulkdeclared', '{}', 0::smallint);
  perform _expect_error(format('select apply_bulk_approval(%L::uuid[], 6, ''{}'')', ids || declared), 'not eligible for bulk approval');
  assert (select count(*) from candidate where id = any(ids) and status = 'approved') = 0, 'failed bulk must be all-or-nothing';
  b := apply_bulk_approval(ids, 5, '{"lane":"bulk"}');
  assert (select count(*) from candidate where id = any(ids) and status = 'approved') = 5;
  perform undo_bulk_action(b, 'test undo');
  assert (select count(*) from candidate where id = any(ids) and status = 'eligible') = 5, 'undo must restore previous status';
  perform _expect_error(format('select undo_bulk_action(%L, ''again'')', b), 'already undone');
end $$;
do $$ begin
  perform _expect_error('select apply_bulk_approval((select array_agg(gen_random_uuid()) from generate_series(1, 501)), 501, ''{}'')', 'bulk scope');
end $$;

-- ---- 8. client roles cannot read raw or review data, and the public view exposes no raw columns
do $$ begin
  assert not has_table_privilege('anon', 'source_record', 'select'), 'anon must not read raw source records';
  assert not has_table_privilege('anon', 'candidate', 'select');
  assert not has_table_privilege('authenticated', 'source_record', 'select');
  assert not has_table_privilege('authenticated', 'audit_log', 'select');
  assert has_table_privilege('anon', 'public_listing', 'select');
  assert (select count(*) from information_schema.columns where table_name = 'public_listing' and column_name in ('raw','author_login','requester_contact','candidate_id')) = 0, 'public view must not expose internal columns';
end $$;

rollback;  -- nothing from this suite is kept
