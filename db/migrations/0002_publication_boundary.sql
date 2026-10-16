-- 0002_publication_boundary.sql
-- Applied and tested on an in-process Postgres (PGlite) via db/tests/run.mjs. NOT yet applied to a real Supabase/Postgres server: owner-role, auth.uid() and platform default privileges are assumptions until then. Depends on 0001.
-- Purpose: make the publication boundary unbypassable from the database layer, mirroring the executable specification in
-- tools/upstream-import/lib/gates.mjs (tested). Requirements:
--   * importing never approves or publishes; only the functions below may set status approved/published
--   * a listing row can only exist for an approved candidate whose gates P1-P8 pass at that moment
--   * security flags, removal holds, suppression and rights restrictions are never cleared or bypassed by a bulk action
--   * bulk actions: previewed count must equal applied count, at most 500 candidates, all-or-nothing, undoable
--   * re-importing cannot resurrect a removed or suppressed candidate
--   * every transition writes review_decision + audit_log
-- Run db/tests/publication_boundary.test.sql against an empty staging database before use.
-- Known unverified assumptions: (1) the migration/owner role bypasses RLS, so security-definer functions can write the
-- tables; (2) auth.uid() / auth.users are the Supabase ones; (3) set_config('app.in_transition', ..., true) is transaction-local
-- and therefore cannot leak between sessions; (4) trigger behaviour for superuser maintenance sessions (a superuser can still
-- disable triggers; operational policy: never do that on production).

begin;

-- ---------------------------------------------------------------- listing draft (what would be shown; reviewer-edited)
create table listing_draft (
  candidate_id uuid primary key references candidate(id) on delete cascade,
  title text,
  summary text,                                    -- ORIGINAL text; never copied third-party prose
  summary_kind text check (summary_kind in ('template','reviewer_written')),
  summary_approved_by uuid references auth.users(id),
  summary_approved_at timestamptz,
  content_type text,
  install_text text,                               -- declared package/endpoint text, or the literal 'not documented'
  licence text,                                    -- SPDX id or the literal 'unknown'
  last_checked_at timestamptz,
  evidence_level smallint not null default 0 check (evidence_level between 0 and 3),
  facts jsonb not null default '{}'::jsonb,
  source_links jsonb not null default '[]'::jsonb,
  rights_flags jsonb not null default '{}'::jsonb  -- {third_party_media:bool, personal_data:bool}
);
alter table listing_draft enable row level security;
revoke all on listing_draft from anon, authenticated;

-- ---------------------------------------------------------------- gate evaluation (single source of truth in the DB)
create or replace function publication_gate_failures(p_candidate uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  c candidate%rowtype; d listing_draft%rowtype; ev eligibility_evaluation%rowtype; f text[] := '{}';
begin
  select * into c from candidate where id = p_candidate;
  if not found then return array['P0 candidate not found']; end if;
  select * into d from listing_draft where candidate_id = p_candidate;
  select * into ev from eligibility_evaluation where candidate_id = p_candidate and is_current;

  if coalesce(ev.category, '') <> 'eligible' and coalesce(btrim(c.override_reason), '') = '' then f := f || 'P1 not eligible and no written reviewer override'; end if;
  if cardinality(c.security_flags) > 0 and c.security_cleared_at is null then f := f || 'P2 unresolved security flag'; end if;
  if c.removal_hold then f := f || 'P3 removal hold'; end if;
  if is_suppressed(c.canonical_key) or not c.importable then f := f || 'P3 suppressed or not importable'; end if;
  -- an open OR accepted takedown/rights request blocks, whether it references the candidate or only its listing
  if exists (select 1 from takedown_request t
             where t.status in ('open','accepted')
               and (t.candidate_id = c.id or t.listing_id in (select l.id from listing l where l.candidate_id = c.id))) then f := f || 'P3 open or accepted takedown or rights complaint'; end if;
  if exists (select 1 from duplicate_group_member m join duplicate_group g on g.id = m.group_id
             where m.candidate_id = c.id and g.needs_manual_review) then f := f || 'P4 unresolved duplicate group'; end if;
  if d.candidate_id is null or coalesce(d.title,'') = '' or coalesce(d.install_text,'') = '' or coalesce(d.licence,'') = ''
     or coalesce(d.content_type,'') = '' or d.last_checked_at is null or jsonb_array_length(d.source_links) = 0 then f := f || 'P5 missing minimum listing data'; end if;
  if d.summary_approved_by is null or coalesce(d.summary,'') = '' then f := f || 'P6 summary not approved'; end if;
  if exists (select 1 from source_candidate_map m join source_record r on r.id = m.source_record_id
             where m.candidate_id = c.id and r.rights_status in ('restricted','removed'))
     or coalesce((d.rights_flags->>'third_party_media')::boolean, false)
     or coalesce((d.rights_flags->>'personal_data')::boolean, false) then f := f || 'P7 rights or privacy restriction'; end if;
  if d.evidence_level = 0 and not exists (select 1 from review_decision r where r.candidate_id = c.id and r.action = 'approve' and r.bulk_action_id is null)
     then f := f || 'P8 declared-only evidence needs an individual approval'; end if;
  return f;
end $$;

-- ---------------------------------------------------------------- guards: status and listing cannot be written directly
create or replace function guard_candidate_status() returns trigger language plpgsql as $$
begin
  if new.status in ('approved','published') and new.status is distinct from old.status
     and coalesce(current_setting('app.in_transition', true), '') <> 'on' then
    raise exception 'status % can only be set by the transition functions', new.status using errcode = '42501';
  end if;
  return new;
end $$;
create trigger candidate_status_guard before update of status on candidate for each row execute function guard_candidate_status();

create or replace function guard_listing() returns trigger language plpgsql as $$
declare st candidate_status; f text[];
begin
  -- withdrawing a listing (setting unpublished_at) must always be possible, whatever the candidate status or gate state
  if tg_op = 'UPDATE' and old.unpublished_at is null and new.unpublished_at is not null then
    if (new.candidate_id, new.slug, new.title, new.summary, new.facts, new.evidence_level, new.evidence_checked_at, new.source_links, new.published_by, new.published_at)
       is distinct from (old.candidate_id, old.slug, old.title, old.summary, old.facts, old.evidence_level, old.evidence_checked_at, old.source_links, old.published_by, old.published_at)
    then raise exception 'a withdrawal may not change other listing columns' using errcode = '42501'; end if;
    return new;
  end if;
  select status into st from candidate where id = new.candidate_id;
  if st is distinct from 'approved' and st is distinct from 'published' then
    raise exception 'listing requires an approved candidate (status is %)', st using errcode = '42501';
  end if;
  f := publication_gate_failures(new.candidate_id);
  if cardinality(f) > 0 and new.unpublished_at is null then
    raise exception 'publication gates failing: %', array_to_string(f, '; ') using errcode = '42501';
  end if;
  return new;
end $$;
create trigger listing_guard before insert or update on listing for each row execute function guard_listing();

-- ---------------------------------------------------------------- re-import: never resurrects, never publishes
create or replace function import_upsert_candidate(p_key text, p_identity text, p_facts jsonb, p_batch uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; sup boolean;
begin
  sup := is_suppressed(p_key);
  insert into candidate (canonical_key, identity_type, facts, created_batch_id, importable)
  values (p_key, p_identity, p_facts, p_batch, not sup)
  on conflict (canonical_key) do update
    set facts = excluded.facts,                       -- refresh tier 1/2 facts only
        importable = candidate.importable and not sup, -- can only become false here, never true again
        updated_at = now()
  returning id into cid;                              -- status is NEVER touched by an import
  return cid;
end $$;
revoke all on function import_upsert_candidate(text, text, jsonb, uuid) from public, anon, authenticated;
-- The importer runs with the server-side service role only (never a browser key); grant it explicitly rather than relying on
-- platform default privileges.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function import_upsert_candidate(text, text, jsonb, uuid) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------- transitions (reviewer only)
create or replace function _transition(p_candidate uuid, p_action review_action, p_to candidate_status, p_reason text, p_bulk uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur candidate_status; f text[];
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select status into cur from candidate where id = p_candidate for update;
  if cur is null then raise exception 'unknown candidate'; end if;
  if not (
       (p_action = 'approve'   and cur in ('eligible','needs_review','ineligible','unavailable','rejected') and p_to = 'approved')
    or (p_action = 'publish'   and cur = 'approved' and p_to = 'published')
    or (p_action = 'unpublish' and cur = 'published' and p_to = 'withdrawn')
    or (p_action = 'reject'    and cur not in ('published') and p_to = 'rejected')
    or (p_action = 'reopen'    and cur in ('rejected','withdrawn','unavailable') and p_to = 'needs_review')
    or (p_action = 'mark_unavailable' and cur not in ('published') and p_to = 'unavailable')) then
    raise exception 'illegal transition % -> % via %', cur, p_to, p_action;
  end if;
  perform set_config('app.in_transition', 'on', true);
  if p_to = 'approved' then
    f := publication_gate_failures(p_candidate) ;
    -- the approval itself satisfies P8 only when it is individual; evaluate with the decision about to be recorded
    if p_bulk is null then f := array_remove(f, 'P8 declared-only evidence needs an individual approval'); end if;
    if cardinality(f) > 0 then raise exception 'approval blocked by gates: %', array_to_string(f, '; ') using errcode = '42501'; end if;
  end if;
  if p_action = 'unpublish' then update listing set unpublished_at = now() where candidate_id = p_candidate and unpublished_at is null; end if;
  update candidate set status = p_to, updated_at = now() where id = p_candidate;
  insert into review_decision (candidate_id, action, from_status, to_status, reason, reviewer_id, bulk_action_id)
    values (p_candidate, p_action, cur, p_to, p_reason, auth.uid(), p_bulk);
  insert into audit_log (actor, action, entity, entity_id, before, after)
    values (auth.uid(), p_action::text, 'candidate', p_candidate::text, jsonb_build_object('status', cur), jsonb_build_object('status', p_to, 'bulk', p_bulk));
  perform set_config('app.in_transition', 'off', true);
end $$;
revoke all on function _transition(uuid, review_action, candidate_status, text, uuid) from public, anon, authenticated;

create or replace function review_candidate(p_candidate uuid, p_action review_action, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _transition(p_candidate, p_action,
    case p_action when 'approve' then 'approved' when 'publish' then 'published' when 'unpublish' then 'withdrawn' when 'reject' then 'rejected'
                  when 'reopen' then 'needs_review' when 'mark_unavailable' then 'unavailable' end::candidate_status, p_reason, null);
end $$;

-- Clearing a security flag or a removal hold is INDIVIDUAL only and has its own audited functions; no bulk path exists.
create or replace function clear_security_flag(p_candidate uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  update candidate set security_cleared_at = now(), security_cleared_by = auth.uid() where id = p_candidate;
  insert into audit_log (actor, action, entity, entity_id, after) values (auth.uid(), 'clear_security_flag', 'candidate', p_candidate::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function clear_removal_hold(p_candidate uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if exists (select 1 from takedown_request t where t.candidate_id = p_candidate and t.status = 'open') then raise exception 'open takedown request'; end if;
  update candidate set removal_hold = false where id = p_candidate;
  insert into audit_log (actor, action, entity, entity_id, after) values (auth.uid(), 'clear_removal_hold', 'candidate', p_candidate::text, jsonb_build_object('reason', p_reason));
end $$;

-- Removal path: suppression, importability, unpublication and status change happen together in one transaction.
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
                      when 'rejected' then cur when 'withdrawn' then cur
                      else 'rejected'::candidate_status end
    where id = p_candidate;
  update listing set unpublished_at = coalesce(unpublished_at, now()) where candidate_id = p_candidate;
  if cur = 'published' then
    insert into review_decision (candidate_id, action, from_status, to_status, reason, reviewer_id) values (p_candidate, 'suppress', cur, 'withdrawn', p_reason, auth.uid());
  elsif cur not in ('rejected','withdrawn') then
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
    on conflict (candidate_id) do update set unpublished_at = null, title = excluded.title, summary = excluded.summary, facts = excluded.facts
    returning id into lid;
  return lid;
end $$;

-- Bulk approval: bounded, previewed, all-or-nothing, never clears flags/holds, never touches declared-only evidence.
create or replace function apply_bulk_approval(p_candidates uuid[], p_confirmed_count integer, p_filter jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid; cid uuid; n integer := coalesce(cardinality(p_candidates), 0);
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if n < 1 or n > 500 then raise exception 'bulk scope must be 1..500 candidates (got %)', n; end if;
  if p_confirmed_count is distinct from n then raise exception 'confirmed count % differs from previewed %', p_confirmed_count, n; end if;
  insert into bulk_action (action, filter, candidate_count, decided_by, confirmed_count_shown)
    values ('approve', p_filter, n, auth.uid(), p_confirmed_count) returning id into b;
  foreach cid in array p_candidates loop
    if exists (select 1 from candidate c where c.id = cid and (cardinality(c.security_flags) > 0 or c.removal_hold or not c.importable or is_suppressed(c.canonical_key)))
       or exists (select 1 from takedown_request t where t.candidate_id = cid and t.status in ('open','accepted'))
       or exists (select 1 from listing_draft d where d.candidate_id = cid and d.evidence_level < 2) then
      raise exception 'candidate % is not eligible for bulk approval (flag, hold, suppression or evidence level)', cid;
    end if;
    perform _transition(cid, 'approve', 'approved', 'bulk approval ' || b::text, b);
  end loop;
  return b;
end $$;

create or replace function undo_bulk_action(p_bulk uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if exists (select 1 from bulk_action where id = p_bulk and undone_at is not null) then raise exception 'already undone'; end if;
  if exists (select 1 from review_decision d join candidate c on c.id = d.candidate_id where d.bulk_action_id = p_bulk and c.status = 'published')
     then raise exception 'unpublish affected listings before undoing'; end if;
  perform set_config('app.in_transition', 'on', true);
  for r in select candidate_id, from_status from review_decision where bulk_action_id = p_bulk loop
    update candidate set status = r.from_status, updated_at = now() where id = r.candidate_id;
  end loop;
  perform set_config('app.in_transition', 'off', true);
  update bulk_action set undone_at = now() where id = p_bulk;
  insert into audit_log (actor, action, entity, entity_id, after) values (auth.uid(), 'undo_bulk_action', 'bulk_action', p_bulk::text, jsonb_build_object('reason', p_reason));
end $$;

-- Only authenticated sessions may call the public entry points; each re-checks is_reviewer().
revoke all on function publication_gate_failures(uuid), review_candidate(uuid, review_action, text), clear_security_flag(uuid, text),
  clear_removal_hold(uuid, text), publish_listing(uuid, text), apply_bulk_approval(uuid[], integer, jsonb), undo_bulk_action(uuid, text), suppress_candidate(uuid, text, uuid) from public, anon;
grant execute on function review_candidate(uuid, review_action, text), clear_security_flag(uuid, text), clear_removal_hold(uuid, text),
  publish_listing(uuid, text), apply_bulk_approval(uuid[], integer, jsonb), undo_bulk_action(uuid, text), suppress_candidate(uuid, text, uuid) to authenticated;

commit;
