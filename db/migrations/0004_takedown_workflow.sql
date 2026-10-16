-- 0004_takedown_workflow.sql
-- Depends on 0001-0003. Implements the correction/removal workflow of reports/publication-gate-checklist.md (LG3):
--   request recorded -> hold applied at once -> ownership checked -> decision with a reason -> suppression (re-import cannot resurrect).
-- Policy choice made here (recorded in reports/implementation-log.md, item 18): a candidate under a removal hold is HIDDEN from the
-- public read model until a person decides. Conservative towards rights holders; a wrongly held listing is restored by
-- clear_removal_hold, an individual audited action.
begin;

-- The public read model additionally requires "no removal hold". (create or replace keeps the same columns.)
create or replace view public_listing with (security_invoker = false) as
  select l.slug, l.title, l.summary, l.facts, l.evidence_level, l.evidence_checked_at, l.source_links, l.published_at
  from listing l
  join candidate c on c.id = l.candidate_id
  where l.unpublished_at is null
    and c.status = 'published'
    and c.importable
    and not c.removal_hold
    and not is_suppressed(c.canonical_key);
grant select on public_listing to anon, authenticated;

-- Record a request received through the published contact address. p_ref is a canonical key or a listing slug.
-- removal and rights_complaint put the candidate on hold immediately; a correction only blocks new approvals (gate P3 sees the open request).
create or replace function record_takedown_request(p_kind text, p_ref text, p_contact text, p_details text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; lid uuid; tid uuid;
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if p_kind not in ('removal','correction','rights_complaint') then raise exception 'unknown request kind %', p_kind; end if;
  select l.candidate_id, l.id into cid, lid from listing l where l.slug = p_ref;
  if cid is null then select id into cid from candidate where lower(canonical_key) = lower(p_ref); end if;
  if cid is null then raise exception 'no candidate or listing matches %', p_ref; end if;
  insert into takedown_request (kind, candidate_id, listing_id, requester_contact, details)
    values (p_kind, cid, lid, p_contact, p_details) returning id into tid;
  if p_kind in ('removal','rights_complaint') then
    update candidate set removal_hold = true, updated_at = now() where id = cid;
  end if;
  insert into audit_log (actor, action, entity, entity_id, after)
    values (auth.uid(), 'record_takedown_request', 'takedown_request', tid::text, jsonb_build_object('kind', p_kind, 'candidate', cid));
  return tid;
end $$;

create or replace function verify_takedown_ownership(p_id uuid, p_basis text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if coalesce(btrim(p_basis), '') = '' then raise exception 'the basis of the ownership check is required'; end if;
  update takedown_request set ownership_verified = true where id = p_id and status = 'open';
  if not found then raise exception 'no open request %', p_id; end if;
  insert into audit_log (actor, action, entity, entity_id, after)
    values (auth.uid(), 'verify_takedown_ownership', 'takedown_request', p_id::text, jsonb_build_object('basis', p_basis));
end $$;

-- Decide an open request. accept: a removal needs a verified owner (otherwise use suppress_candidate directly, which needs no request),
-- and suppresses the key; a correction is only marked done. reject / withdraw leave the hold in place until clear_removal_hold.
create or replace function resolve_takedown_request(p_id uuid, p_decision text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t takedown_request%rowtype;
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if p_decision not in ('accept','reject','withdraw') then raise exception 'decision must be accept, reject or withdraw'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into t from takedown_request where id = p_id for update;
  if not found then raise exception 'unknown request'; end if;
  if t.status <> 'open' then raise exception 'request already %', t.status; end if;
  if p_decision = 'accept' and t.kind = 'removal' and not t.ownership_verified then
    raise exception 'ownership has not been verified';
  end if;
  update takedown_request set status = case p_decision when 'accept' then 'accepted' when 'reject' then 'rejected' else 'withdrawn' end,
         resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  if p_decision = 'accept' and t.kind in ('removal','rights_complaint') then
    perform suppress_candidate(t.candidate_id, p_reason, p_id);
  end if;
  insert into audit_log (actor, action, entity, entity_id, after)
    values (auth.uid(), 'resolve_takedown_request', 'takedown_request', p_id::text, jsonb_build_object('decision', p_decision, 'reason', p_reason));
end $$;

-- Gates: an accepted CORRECTION no longer blocks (it is done); an open request, or an accepted removal / rights complaint, still does.
create or replace function publication_gate_failures(p_candidate uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  c candidate%rowtype; d listing_draft%rowtype; ev eligibility_evaluation%rowtype; f text[] := '{}';
begin
  select * into c from candidate where id = p_candidate;
  if not found then return array['P0 candidate not found']; end if;
  select * into d from listing_draft where candidate_id = p_candidate;
  select * into ev from eligibility_evaluation where candidate_id = p_candidate and is_current;

  if coalesce(ev.category, '') <> 'eligible' and coalesce(btrim(c.override_reason), '') = '' then f := array_append(f, 'P1 not eligible and no written reviewer override'::text); end if;
  if cardinality(c.security_flags) > 0 and c.security_cleared_at is null then f := array_append(f, 'P2 unresolved security flag'::text); end if;
  if c.removal_hold then f := array_append(f, 'P3 removal hold'::text); end if;
  if is_suppressed(c.canonical_key) or not c.importable then f := array_append(f, 'P3 suppressed or not importable'::text); end if;
  -- an open OR accepted takedown/rights request blocks, whether it references the candidate or only its listing
  if exists (select 1 from takedown_request t
             where (t.status = 'open' or (t.status = 'accepted' and t.kind <> 'correction'))
               and (t.candidate_id = c.id or t.listing_id in (select l.id from listing l where l.candidate_id = c.id))) then f := array_append(f, 'P3 open or accepted takedown or rights complaint'::text); end if;
  if exists (select 1 from duplicate_group_member m join duplicate_group g on g.id = m.group_id
             where m.candidate_id = c.id and g.needs_manual_review) then f := array_append(f, 'P4 unresolved duplicate group'::text); end if;
  if d.candidate_id is null or coalesce(d.title,'') = '' or coalesce(d.install_text,'') = '' or coalesce(d.licence,'') = ''
     or coalesce(d.content_type,'') = '' or d.last_checked_at is null or jsonb_array_length(d.source_links) = 0 then f := array_append(f, 'P5 missing minimum listing data'::text); end if;
  if d.summary_approved_by is null or coalesce(d.summary,'') = '' then f := array_append(f, 'P6 summary not approved'::text); end if;
  if exists (select 1 from source_candidate_map m join source_record r on r.id = m.source_record_id
             where m.candidate_id = c.id and r.rights_status in ('restricted','removed'))
     or coalesce((d.rights_flags->>'third_party_media')::boolean, false)
     or coalesce((d.rights_flags->>'personal_data')::boolean, false) then f := array_append(f, 'P7 rights or privacy restriction'::text); end if;
  if d.evidence_level = 0 and not exists (select 1 from review_decision r where r.candidate_id = c.id and r.action = 'approve' and r.bulk_action_id is null)
     then f := array_append(f, 'P8 declared-only evidence needs an individual approval'::text); end if;
  return f;
end $$;

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
       or exists (select 1 from takedown_request t where t.candidate_id = cid and (t.status = 'open' or (t.status = 'accepted' and t.kind <> 'correction')))
       or exists (select 1 from listing_draft d where d.candidate_id = cid and d.evidence_level < 2) then
      raise exception 'candidate % is not eligible for bulk approval (flag, hold, suppression or evidence level)', cid;
    end if;
    perform _transition(cid, 'approve', 'approved', 'bulk approval ' || b::text, b);
  end loop;
  return b;
end $$;

revoke all on function record_takedown_request(text, text, text, text), verify_takedown_ownership(uuid, text), resolve_takedown_request(uuid, text, text) from public, anon;
grant execute on function record_takedown_request(text, text, text, text), verify_takedown_ownership(uuid, text), resolve_takedown_request(uuid, text, text) to authenticated;

commit;
