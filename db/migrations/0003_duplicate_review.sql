-- 0003_duplicate_review.sql
-- Depends on 0001-0002. Gives reviewers an audited way to resolve a duplicate/ambiguity group, which clears gate P4
-- (publication_gate_failures: "P4 unresolved duplicate group"). Until a group is resolved no member can be approved.
begin;

create or replace function resolve_duplicate_group(p_group uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare g duplicate_group%rowtype;
begin
  if not is_reviewer() then raise exception 'reviewer role required' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into g from duplicate_group where id = p_group for update;
  if not found then raise exception 'unknown duplicate group'; end if;
  if not g.needs_manual_review then raise exception 'group already resolved'; end if;
  update duplicate_group set needs_manual_review = false where id = p_group;
  insert into audit_log (actor, action, entity, entity_id, before, after)
    values (auth.uid(), 'resolve_duplicate_group', 'duplicate_group', p_group::text,
            jsonb_build_object('needs_manual_review', true, 'method', g.method),
            jsonb_build_object('needs_manual_review', false, 'reason', p_reason));
end $$;

revoke all on function resolve_duplicate_group(uuid, text) from public, anon;
grant execute on function resolve_duplicate_group(uuid, text) to authenticated;

commit;
