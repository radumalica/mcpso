-- roles_rls.test.sql: behaviour of the client roles (anon, authenticated plain user, authenticated reviewer) under RLS and
-- grants. Unlike the static has_table_privilege checks, every statement here is executed under `set local role`.
-- Run after migrations 0001-0002 on an empty database (db/tests/run.mjs does this); rolls back at the end.

begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000d2');
insert into app_role (user_id, role) values ('00000000-0000-0000-0000-0000000000c1', 'reviewer');    -- d2 is a plain user
insert into import_batch (id, source_repo, mode, tool_version) values ('22222222-2222-2222-2222-222222222222', 'example/source', 'full', 'test');
select import_upsert_candidate('github.com/r/one', 'github_repo', '{}'::jsonb, '22222222-2222-2222-2222-222222222222');

create or replace function _denied(sql text) returns void language plpgsql as $$
begin
  begin execute sql; exception when insufficient_privilege or others then
    if sqlstate in ('42501') or sqlerrm ilike '%reviewer role required%' or sqlerrm ilike '%row-level security%' then return; end if;
    raise exception 'unexpected error [%]: % (%)', sql, sqlerrm, sqlstate;
  end;
  raise exception 'expected access to be denied for [%]', sql;
end $$;
grant execute on function _denied(text) to anon, authenticated;

-- ---- anon: nothing except the public view
set local role anon;
do $$ begin
  perform _denied('select * from candidate');
  perform _denied('select * from source_record');
  perform _denied('select * from audit_log');
  perform _denied('select * from suppression');
  perform _denied('insert into candidate (canonical_key, identity_type) values (''x'', ''endpoint'')');
  perform _denied('insert into listing (candidate_id, slug, title, summary) values (gen_random_uuid(), ''x'', ''x'', ''x'')');
  perform _denied('select review_candidate(gen_random_uuid(), ''approve'', ''x'')');
  perform _denied('select suppress_candidate(gen_random_uuid(), ''x'')');
  perform _denied('select publish_listing(gen_random_uuid(), ''x'')');
  perform _denied('select import_upsert_candidate(''github.com/x/y'', ''github_repo'', ''{}'', null)');
  assert (select count(*) from public_listing) = 0;
end $$;
reset role;

-- ---- authenticated, not a reviewer: sees no review rows, cannot call any transition function
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
do $$ begin
  assert (select count(*) from candidate) = 0, 'a plain user must see no candidate rows (RLS)';
  perform _denied('select * from source_record');
  perform _denied('select * from audit_log');
  perform _denied('insert into candidate (canonical_key, identity_type) values (''y'', ''endpoint'')');
  perform _denied('update candidate set status = ''approved''');
  perform _denied('select review_candidate((select id from candidate limit 1), ''approve'', ''x'')');
  perform _denied('select review_candidate(gen_random_uuid(), ''approve'', ''x'')');
  perform _denied('select suppress_candidate(gen_random_uuid(), ''x'')');
  perform _denied('select apply_bulk_approval(array[gen_random_uuid()], 1, ''{}'')');
  perform _denied('select import_upsert_candidate(''github.com/x/y'', ''github_repo'', ''{}'', null)');
end $$;
reset role;

-- ---- authenticated reviewer: may read review tables through policies, still cannot write tables directly
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$ begin
  assert (select count(*) from candidate) = 1, 'a reviewer must see candidates';
  perform _denied('select * from source_record');                         -- raw data stays server-side even for reviewers
  perform _denied('update candidate set status = ''approved''');          -- no direct table writes, only the functions
  perform _denied('insert into listing (candidate_id, slug, title, summary) values ((select id from candidate limit 1), ''z'', ''z'', ''z'')');
  perform _denied('insert into suppression (canonical_key, reason, created_by) values (''k'', ''r'', auth.uid())');
  perform _denied('select import_upsert_candidate(''github.com/x/y'', ''github_repo'', ''{}'', null)');  -- importer-only (service role)
end $$;
reset role;

-- ---- service_role (importer / server runtime) is the only client-style role allowed to run the importer function
set local role service_role;
do $$ begin
  perform import_upsert_candidate('github.com/r/two', 'github_repo', '{}'::jsonb, '22222222-2222-2222-2222-222222222222');
end $$;
reset role;

rollback;
