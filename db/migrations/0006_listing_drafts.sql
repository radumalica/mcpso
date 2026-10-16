-- 0006_listing_drafts.sql
-- Depends on 0001-0005. Reviewer-only creation of listing drafts and approval of their summaries (gates P5 and P6).
--   save_listing_draft:        stores the proposed listing text and minimum data; any change to the summary withdraws a prior approval.
--   approve_listing_summaries: a person approves the summary text. Template summaries may be approved in a bounded batch after the
--                              reviewer has read a sample; reviewer-written summaries are approved one at a time.
-- Neither function changes a candidate's status; approval of the candidate itself is still review_candidate with all gates P1-P8.
begin;

create or replace function save_listing_draft(p_candidate uuid, p_draft jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare st candidate_status; old listing_draft%rowtype; cur listing_draft%rowtype; new_summary text;
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  select status into st from candidate where id = p_candidate;
  if st is null then raise exception 'unknown candidate'; end if;
  if st = 'published' then raise exception 'a published listing cannot be edited; withdraw it first' using errcode = '42501'; end if;
  if jsonb_typeof(p_draft) <> 'object' then raise exception 'draft must be a JSON object'; end if;
  if (p_draft->>'summary_kind') is not null and (p_draft->>'summary_kind') not in ('template','reviewer_written') then raise exception 'unknown summary_kind'; end if;
  new_summary := p_draft->>'summary';
  select * into old from listing_draft where candidate_id = p_candidate;

  insert into listing_draft (candidate_id, title, summary, summary_kind, content_type, install_text, licence, last_checked_at,
                             evidence_level, facts, source_links, rights_flags)
  values (p_candidate, p_draft->>'title', new_summary, p_draft->>'summary_kind', p_draft->>'content_type', p_draft->>'install_text',
          p_draft->>'licence', nullif(p_draft->>'last_checked_at', '')::timestamptz, coalesce((p_draft->>'evidence_level')::smallint, 0),
          coalesce(p_draft->'facts', '{}'::jsonb), coalesce(p_draft->'source_links', '[]'::jsonb), coalesce(p_draft->'rights_flags', '{}'::jsonb))
  on conflict (candidate_id) do update set
    title = excluded.title, summary = excluded.summary, summary_kind = excluded.summary_kind, content_type = excluded.content_type,
    install_text = excluded.install_text, licence = excluded.licence, last_checked_at = excluded.last_checked_at,
    evidence_level = excluded.evidence_level, facts = excluded.facts, source_links = excluded.source_links, rights_flags = excluded.rights_flags,
    -- changed text must be approved again
    summary_approved_by = case when listing_draft.summary is not distinct from excluded.summary then listing_draft.summary_approved_by end,
    summary_approved_at = case when listing_draft.summary is not distinct from excluded.summary then listing_draft.summary_approved_at end;

  -- Fail closed: an approval was decided on the draft as it was. If anything the public would see changes after approval, the
  -- candidate goes back to review and must be approved again (otherwise facts, evidence level or rights flags could change between
  -- approval and publication without anyone looking).
  if st = 'approved' and old.candidate_id is not null then
    select * into cur from listing_draft where candidate_id = p_candidate;
    if (old.title, old.summary, old.summary_kind, old.content_type, old.install_text, old.licence, old.last_checked_at, old.evidence_level, old.facts, old.source_links, old.rights_flags)
       is distinct from
       (cur.title, cur.summary, cur.summary_kind, cur.content_type, cur.install_text, cur.licence, cur.last_checked_at, cur.evidence_level, cur.facts, cur.source_links, cur.rights_flags) then
      update candidate set status = 'needs_review', updated_at = now() where id = p_candidate;
      insert into review_decision (candidate_id, action, from_status, to_status, reason, reviewer_id)
        values (p_candidate, 'reopen', 'approved', 'needs_review', 'listing draft edited after approval; approval withdrawn', auth.uid());
    end if;
  end if;

  insert into audit_log (actor, action, entity, entity_id, after)
    values (auth.uid(), 'save_listing_draft', 'candidate', p_candidate::text,
            jsonb_build_object('summary_kind', p_draft->>'summary_kind', 'summary_changed', old.summary is distinct from new_summary));
end $$;

create or replace function approve_listing_summaries(p_candidates uuid[], p_reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := coalesce(cardinality(p_candidates), 0); done integer;
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if n < 1 or n > 200 then raise exception 'between 1 and 200 summaries per call (got %)', n; end if;
  if exists (select 1 from listing_draft d where d.candidate_id = any(p_candidates) and d.summary_kind = 'reviewer_written') and n > 1 then
    raise exception 'reviewer-written summaries are approved one at a time';
  end if;
  if (select count(*) from listing_draft d where d.candidate_id = any(p_candidates) and coalesce(btrim(d.summary), '') <> '' and d.summary_kind is not null) <> n then
    raise exception 'every candidate needs a draft with a summary text and kind';
  end if;
  update listing_draft set summary_approved_by = auth.uid(), summary_approved_at = now() where candidate_id = any(p_candidates);
  get diagnostics done = row_count;
  insert into audit_log (actor, action, entity, entity_id, after)
    values (auth.uid(), 'approve_listing_summaries', 'listing_draft', 'batch', jsonb_build_object('count', done, 'reason', p_reason, 'candidates', to_jsonb(p_candidates)));
  return done;
end $$;

revoke all on function save_listing_draft(uuid, jsonb), approve_listing_summaries(uuid[], text) from public, anon;
grant execute on function save_listing_draft(uuid, jsonb), approve_listing_summaries(uuid[], text) to authenticated;

commit;
