-- 0007_hardening.sql
-- Depends on 0001-0006. Fixes found by an independent review of 0001-0006 (see reports/implementation-log.md, item 23):
--  1. every SECURITY DEFINER function pins search_path to "public, pg_temp" and temporary tables are revoked from client roles
--     (a temp table named like a real one could shadow app_role inside is_reviewer());
--  2. is_suppressed() is SECURITY DEFINER so the public view works for anon once a published row exists;
--  3. suppress_candidate works for candidates that are 'duplicate' or whose listing is already withdrawn;
--  4. an import under a suppressed key withdraws an approved/published candidate instead of violating a check constraint;
--  5. the importer's service role loses blanket table rights (it is not a bypass of the publication gates), and a candidate can no
--     longer be INSERTed as approved or published;
--  6. undo_bulk_action reverts only still-approved candidates, records each revert and refuses unknown ids;
--  7. re-publishing refreshes evidence level, check date and source links.
begin;

create or replace function suppress_candidate(p_candidate uuid, p_reason text, p_takedown uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text; cur candidate_status;
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select canonical_key, status into k, cur from candidate where id = p_candidate for update;
  if k is null then raise exception 'unknown candidate'; end if;
  insert into suppression (canonical_key, reason, takedown_id, created_by) values (k, p_reason, p_takedown, auth.uid()) on conflict (canonical_key) do nothing;
  perform set_config('app.in_transition', 'on', true);
  -- One statement: status, importable and the hold change together, otherwise a published candidate would briefly be
  -- "published and not importable", which the candidate check constraint forbids.
  update candidate set importable = false, removal_hold = true, updated_at = now(),
    status = case cur when 'published' then 'withdrawn'::candidate_status
                      when 'rejected' then cur when 'withdrawn' then cur when 'duplicate' then cur
                      else 'rejected'::candidate_status end
    where id = p_candidate;
  update listing set unpublished_at = now() where candidate_id = p_candidate and unpublished_at is null;
  if cur = 'published' then
    insert into review_decision (candidate_id, action, from_status, to_status, reason, reviewer_id) values (p_candidate, 'suppress', cur, 'withdrawn', p_reason, auth.uid());
  elsif cur not in ('rejected','withdrawn','duplicate') then
    insert into review_decision (candidate_id, action, from_status, to_status, reason, reviewer_id) values (p_candidate, 'suppress', cur, 'rejected', p_reason, auth.uid());
  end if;
  perform set_config('app.in_transition', 'off', true);
  insert into audit_log (actor, action, entity, entity_id, after) values (auth.uid(), 'suppress', 'candidate', p_candidate::text, jsonb_build_object('reason', p_reason, 'previous_status', cur));
end $$;

create or replace function publish_listing(p_candidate uuid, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare d listing_draft%rowtype; lid uuid;
begin
  perform _transition(p_candidate, 'publish', 'published', 'publish approved candidate', null);
  select * into d from listing_draft where candidate_id = p_candidate;
  insert into listing (candidate_id, slug, title, summary, facts, evidence_level, evidence_checked_at, source_links, published_by)
    values (p_candidate, p_slug, d.title, d.summary, d.facts, d.evidence_level, d.last_checked_at, d.source_links, auth.uid())
    on conflict (candidate_id) do update set unpublished_at = null, title = excluded.title, summary = excluded.summary, facts = excluded.facts,
      evidence_level = excluded.evidence_level, evidence_checked_at = excluded.evidence_checked_at, source_links = excluded.source_links,
      published_by = excluded.published_by, published_at = now()
    returning id into lid;
  return lid;
end $$;

create or replace function import_upsert_candidate(p_key text, p_identity text, p_facts jsonb, p_batch uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare cid uuid; sup boolean;
begin
  sup := is_suppressed(p_key);
  insert into candidate (canonical_key, identity_type, facts, created_batch_id, importable)
  values (p_key, p_identity, p_facts, p_batch, not sup)
  on conflict (canonical_key) do update
    set facts = excluded.facts,                       -- refresh tier 1/2 facts only
        updated_at = now()
  returning id into cid;                              -- status is NEVER raised by an import
  if sup then
    -- A suppressed key (or a key under a suppressed repository) is taken off the public view in one step: the listing is withdrawn and
    -- an approved or published candidate becomes withdrawn, because "approved/published and not importable" is not allowed.
    update listing set unpublished_at = now() where candidate_id = cid and unpublished_at is null;
    update candidate set importable = false, removal_hold = true, updated_at = now(),
           status = case when status in ('approved','published') then 'withdrawn'::candidate_status else status end
     where id = cid and (importable or status in ('approved','published'));
  end if;
  return cid;
end $$;

create or replace function undo_bulk_action(p_bulk uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n integer := 0; total integer;
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if not exists (select 1 from bulk_action where id = p_bulk) then raise exception 'unknown bulk action'; end if;
  if exists (select 1 from bulk_action where id = p_bulk and undone_at is not null) then raise exception 'already undone'; end if;
  if exists (select 1 from review_decision d join candidate c on c.id = d.candidate_id where d.bulk_action_id = p_bulk and c.status = 'published')
     then raise exception 'unpublish affected listings before undoing'; end if;
  select count(*) into total from review_decision where bulk_action_id = p_bulk;
  perform set_config('app.in_transition', 'on', true);
  -- Only candidates that are STILL approved are reverted. A candidate that has since been rejected, withdrawn or suppressed keeps
  -- the later decision. Every revert is recorded.
  for r in select d.candidate_id, d.from_status from review_decision d join candidate c on c.id = d.candidate_id
           where d.bulk_action_id = p_bulk and c.status = 'approved' loop
    update candidate set status = r.from_status, updated_at = now() where id = r.candidate_id;
    insert into review_decision (candidate_id, action, from_status, to_status, reason, reviewer_id)
      values (r.candidate_id, 'reopen', 'approved', r.from_status, 'bulk action undone: ' || p_reason, auth.uid());
    n := n + 1;
  end loop;
  perform set_config('app.in_transition', 'off', true);
  update bulk_action set undone_at = now() where id = p_bulk;
  insert into audit_log (actor, action, entity, entity_id, after)
    values (auth.uid(), 'undo_bulk_action', 'bulk_action', p_bulk::text, jsonb_build_object('reason', p_reason, 'reverted', n, 'in_bulk', total));
end $$;

create or replace function guard_candidate_status() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('approved','published') and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and coalesce(current_setting('app.in_transition', true), '') <> 'on' then
    raise exception 'status % can only be set by the transition functions', new.status using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists candidate_status_guard on candidate;
create trigger candidate_status_guard before insert or update of status on candidate for each row execute function guard_candidate_status();

-- (2) The view is evaluated for the caller; is_suppressed must read the suppression table as its owner, not as anon.
create or replace function is_suppressed(p_key text) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from suppression s
                  where lower(p_key) = lower(s.canonical_key) or lower(p_key) like lower(s.canonical_key) || '/%') $$;

-- (1) Pin the search path of every security definer function in this schema, and take away temporary tables from client roles.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
  -- Best effort (the owner of the database may differ from the migration role): the search_path pin above is the real defence.
  begin
    execute format('revoke temporary on database %I from public', current_database());
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke temporary on database %I from anon', current_database());
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke temporary on database %I from authenticated', current_database());
    end if;
  exception when others then
    raise warning 'could not revoke TEMPORARY from client roles (%): revoke it as the database owner', sqlerrm;
  end;
end $$;

-- Helper predicates are not part of the client API: only the gate/transition code and the public view need them.
revoke execute on function publication_gate_failures(uuid) from public, anon, authenticated;
revoke execute on function is_reviewer() from anon;

-- (5) The importer's service role. Platforms such as Supabase grant it ALL on every table; narrow that to what the loader needs.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on all tables in schema public from service_role;
    revoke all on all sequences in schema public from service_role;
    -- raw and control layers: the importer owns them
    grant select, insert, update on import_batch, import_checkpoint, source_record to service_role;
    grant insert on import_error, source_record_revision to service_role;
    grant select on import_error, source_record_revision to service_role;
    -- candidates: only the machine-maintained columns may change; approval, clearance and merge columns stay out of reach
    grant select, insert on candidate to service_role;
    grant update (name, facts, status, security_flags, removal_hold, importable, content_type, updated_at) on candidate to service_role;
    grant select, insert, update, delete on eligibility_evaluation to service_role;
    grant select, insert, update on source_candidate_map, duplicate_group, duplicate_group_member to service_role;
    -- read-only views of what the importer must respect
    grant select on suppression, takedown_request to service_role;
    grant usage, select on all sequences in schema public to service_role;
    grant execute on function import_upsert_candidate(text, text, jsonb, uuid) to service_role;
    grant execute on function is_suppressed(text) to service_role;
    alter default privileges in schema public revoke all on tables from service_role;
  end if;
end $$;

-- The importer may VOID a security clearance when a newer classification adds a flag, but can never grant one: clearing is a reviewer function.
grant update (security_cleared_at, security_cleared_by) on candidate to service_role;
create or replace function guard_clearance_columns() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user = 'service_role' and (new.security_cleared_at is not null or new.security_cleared_by is not null)
     and (new.security_cleared_at, new.security_cleared_by) is distinct from (old.security_cleared_at, old.security_cleared_by) then
    raise exception 'a security clearance can only be set by a reviewer decision' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists candidate_clearance_guard on candidate;
create trigger candidate_clearance_guard before update of security_cleared_at, security_cleared_by on candidate for each row execute function guard_clearance_columns();


-- Summaries are public text. The wording policy (no "verified", "safe", "secure", "trusted", "recommended") is enforced where the text is stored,
-- so no code path (review tool, future UI, direct SQL) can put such a claim into a draft. Titles are project names and are not checked.
create or replace function guard_summary_wording() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.summary is not null and new.summary ~* '\m(verified|safe|secure|trusted|recommended)\M' then
    raise exception 'summary uses a word the wording policy forbids (verified, safe, secure, trusted, recommended)' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists listing_draft_wording_guard on listing_draft;
create trigger listing_draft_wording_guard before insert or update of summary on listing_draft for each row execute function guard_summary_wording();


-- is_suppressed() would tell any client whether a key was taken down. Function privileges are checked for the caller even inside a view,
-- so the public view carries the same test inline (table access inside the view uses the owner's rights) and the function is not callable by clients.
create or replace view public_listing with (security_invoker = false) as
  select l.slug, l.title, l.summary, l.facts, l.evidence_level, l.evidence_checked_at, l.source_links, l.published_at
  from listing l
  join candidate c on c.id = l.candidate_id
  where l.unpublished_at is null
    and c.status = 'published'
    and c.importable
    and not c.removal_hold
    and not exists (select 1 from suppression s
                    where lower(c.canonical_key) = lower(s.canonical_key) or lower(c.canonical_key) like lower(s.canonical_key) || '/%');
grant select on public_listing to anon, authenticated;
revoke execute on function is_suppressed(text) from public, anon, authenticated;

commit;
