-- 0001_import_pipeline.sql
-- DRAFT, NOT APPLIED, NOT VALIDATED against a running Postgres (no server was available when written).
-- Apply only to a NEW, empty database via the migration runner, never by hand, and run the RLS tests in
-- db/tests (to be written, see reports/import-test-strategy-and-acceptance.md) before any data is loaded.
-- Design: reports/import-schema-and-migrations.md. Target: PostgreSQL 15+ (Supabase).
--
-- Layers (data only flows downward; later layers never mutate earlier ones):
--   raw (source_record) -> normalised candidate -> evaluation -> review decision -> listing (published)

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- helpers
-- candidate_status is the LIFECYCLE of a candidate. It deliberately keeps three concepts apart:
--   importable   (boolean column candidate.importable)  : stored with provenance and not suppressed
--   eligible     (eligibility_evaluation.category)      : machine verdict against the inclusion criteria; 'eligible' here is a status
--                                                          only until a human acts; it is NOT approval
--   approved     (status 'approved')                    : a human decision recorded AND all publication gates P1-P8 passed
-- 'published' means a listing row exists. Only the transition functions in 0002 may set approved/published.
create type candidate_status as enum
  ('candidate','needs_review','eligible','ineligible','duplicate','approved','published','withdrawn','rejected','unavailable');
create type review_action as enum
  ('approve','reject','merge','split','mark_unavailable','request_info','reopen','publish','unpublish','correct_metadata','suppress',
   'clear_security_flag','clear_removal_hold','override_eligibility');
create type source_kind as enum ('issue','pull_request','issue_comment');
create type batch_status as enum ('running','completed','failed','interrupted','dry_run');

create table app_role (            -- who may do what; populated by an admin, never by clients
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('reviewer','admin')),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now()
);

create or replace function is_reviewer() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from app_role where user_id = auth.uid() and role in ('reviewer','admin')) $$;

-- ---------------------------------------------------------------- 1. import control
create table import_batch (
  id uuid primary key default gen_random_uuid(),
  source_repo text not null,                       -- e.g. chatmcp/mcpso
  mode text not null check (mode in ('full','incremental','dry_run')),
  status batch_status not null default 'running',
  tool_version text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb,       -- issues, pull_requests, comments, errors, retries
  note text
);

create table import_checkpoint (
  batch_id uuid not null references import_batch(id) on delete cascade,
  stage text not null,                             -- issues | pulls | comments | pull_files | enrich
  next_url text,
  watermark timestamptz,
  pages integer not null default 0,
  complete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (batch_id, stage)
);

create table import_error (
  id bigint generated always as identity primary key,
  batch_id uuid not null references import_batch(id) on delete cascade,
  stage text not null,
  source_ref text,                                 -- URL or number; never a credential
  http_status integer,
  message text not null,
  retry_count integer not null default 0,
  occurred_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 2. raw source records (restricted, append-only)
create table source_record (
  id uuid primary key default gen_random_uuid(),
  source_repo text not null,
  kind source_kind not null,
  source_id bigint not null,                       -- GitHub numeric id (stable across renames)
  source_number integer,                           -- issue / PR number (or parent issue for comments)
  source_url text not null,
  author_login text,                               -- public handle, kept for attribution only
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_state text,
  raw jsonb not null,                              -- as retrieved; internal only, never served publicly
  content_hash text not null,                      -- sha256 of canonical raw JSON; detects edits
  first_batch_id uuid not null references import_batch(id),
  last_batch_id uuid not null references import_batch(id),
  fetched_at timestamptz not null default now(),
  rights_status text not null default 'unreviewed' check (rights_status in ('unreviewed','facts_only','cleared','restricted','removed')),
  unique (source_repo, kind, source_id)            -- idempotency: re-import upserts, never duplicates
);
create index on source_record (source_repo, source_number);

create table source_record_revision (               -- previous raw versions when content_hash changes (edits)
  id bigint generated always as identity primary key,
  source_record_id uuid not null references source_record(id) on delete cascade,
  content_hash text not null,
  raw jsonb not null,
  batch_id uuid not null references import_batch(id),
  superseded_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 3. canonical candidates
create table candidate (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,              -- github.com/o/r[/subpath] | endpoint:host/path | npm:pkg ...
  identity_type text not null check (identity_type in ('github_repo','endpoint','package')),
  status candidate_status not null default 'candidate',
  content_type text check (content_type in ('server','client','skill','cli_or_library','framework','tool','unknown')),
  name text,
  facts jsonb not null default '{}'::jsonb,        -- tier 1/2 facts only (see policy section 6): repo, packages, endpoints, licence, transports
  merged_into uuid references candidate(id),       -- set when status = 'duplicate'
  importable boolean not null default true,        -- false when the canonical key is suppressed or provenance is incomplete
  security_flags text[] not null default '{}',
  security_cleared_at timestamptz,                 -- set only by an individual reviewer decision (never by a bulk action)
  security_cleared_by uuid references auth.users(id),
  removal_hold boolean not null default false,     -- cleared only by an individual reviewer decision
  override_reason text,                            -- written reviewer override of a non-eligible evaluation (individual only)
  created_batch_id uuid references import_batch(id),
  updated_at timestamptz not null default now(),
  check ((status = 'duplicate') = (merged_into is not null)),
  check (status not in ('approved','published') or importable)
);
create index on candidate (status);

create table source_candidate_map (                 -- EVERY source record has exactly one disposition row; only some point at a candidate
  source_record_id uuid primary key references source_record(id) on delete cascade,
  disposition text not null check (disposition in
    ('mapped','no_identity','not_submission','code_contribution','context_comment','removal_request','link_correction')),
  candidate_id uuid references candidate(id),      -- required for mapped/removal_request/link_correction when a target is known
  check ((disposition = 'mapped') = (candidate_id is not null) or disposition in ('removal_request','link_correction')),
  intent text not null,                            -- submission | removal_request | link_correction | code_contribution | ...
  method text not null,                            -- rule id, e.g. R1 exact-repo, R6 rename, manual
  confidence text not null check (confidence in ('exact','high','medium','low','manual')),
  rationale text,
  mapped_batch_id uuid references import_batch(id),
  mapped_at timestamptz not null default now()
);
create index on source_candidate_map (candidate_id) where candidate_id is not null;

create table duplicate_group (
  id uuid primary key default gen_random_uuid(),
  method text not null,
  confidence text not null check (confidence in ('exact','high','medium','low','manual')),
  needs_manual_review boolean not null default false,
  rationale text,
  created_at timestamptz not null default now()
);
create table duplicate_group_member (
  group_id uuid not null references duplicate_group(id) on delete cascade,
  candidate_id uuid not null references candidate(id),
  role text not null check (role in ('canonical','merged','possible')),
  primary key (group_id, candidate_id)
);

create table merge_history (                        -- reversible: stores what was merged and by whom
  id bigint generated always as identity primary key,
  from_candidate uuid not null references candidate(id),
  into_candidate uuid not null references candidate(id),
  decided_by uuid references auth.users(id),       -- null = automatic rule
  method text not null,
  reason text,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 4. evaluation (machine) and review (human)
create table eligibility_evaluation (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references candidate(id) on delete cascade,
  evaluator_version text not null,                 -- version of the rules + code
  category text not null check (category in ('eligible','needs_review','ineligible')),
  reasons jsonb not null,                          -- [{rule, detail}]  (E1..E4, N1..N9, I1..I3)
  evidence jsonb not null,                         -- strong / weak evidence lists, registry matches, repo facts used
  quality_indicators text[] not null default '{}',
  security_concern boolean not null default false,
  evaluated_at timestamptz not null default now(),
  is_current boolean not null default true
);
create unique index on eligibility_evaluation (candidate_id) where is_current;

create table bulk_action (
  id uuid primary key default gen_random_uuid(),
  action review_action not null,
  filter jsonb not null,                           -- the exact scope shown to the reviewer
  candidate_count integer not null,
  decided_by uuid not null references auth.users(id),
  confirmed_count_shown integer not null,          -- must equal candidate_count
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create table review_decision (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references candidate(id),
  action review_action not null,
  from_status candidate_status not null,
  to_status candidate_status not null,
  reason text not null,
  reviewer_id uuid not null references auth.users(id),
  bulk_action_id uuid references bulk_action(id),
  metadata_patch jsonb,                            -- for correct_metadata; previous values kept in audit_log
  created_at timestamptz not null default now()
);
create index on review_decision (candidate_id, created_at desc);

-- ---------------------------------------------------------------- 5. publication and rights
create table listing (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references candidate(id),
  slug text not null unique,
  title text not null,
  summary text not null,                           -- ORIGINAL text written/approved by a reviewer; not copied third-party prose
  facts jsonb not null,                            -- tier 1/2 only
  evidence_level smallint not null default 0 check (evidence_level between 0 and 3),
  evidence_checked_at timestamptz,
  source_links jsonb not null,                     -- [{url, kind: repo|issue|registry, retrieved_at}]
  published_by uuid not null references auth.users(id),
  published_at timestamptz not null default now(),
  unpublished_at timestamptz
);

create table takedown_request (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('removal','correction','rights_complaint')),
  candidate_id uuid references candidate(id),
  listing_id uuid references listing(id),
  requester_contact text,                          -- private; never shown publicly
  ownership_verified boolean not null default false,
  details text,
  status text not null default 'open' check (status in ('open','accepted','rejected','withdrawn')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

create table suppression (                          -- re-import prevention; consulted by the importer before upsert
  canonical_key text primary key,
  reason text not null,
  takedown_id uuid references takedown_request(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Suppression matching (used by the importer, the gates and the public view): case-insensitive exact key, OR a key below a
-- suppressed repository (suppressing github.com/o/r also covers github.com/o/r/subpath). Renames: a renamed repository is
-- re-keyed by the importer BEFORE this check, and reviewers add both keys when removing a renamed project.
create or replace function is_suppressed(p_key text) returns boolean language sql stable as
$$ select exists (select 1 from suppression s
                  where lower(p_key) = lower(s.canonical_key) or lower(p_key) like lower(s.canonical_key) || '/%') $$;

create table audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 6. row-level security
-- Default deny for client roles: RLS enabled and every privilege revoked from anon/authenticated. FORCE is deliberately NOT used:
-- the table owner (the migration role, which owns the security-definer functions in 0002 and bypasses RLS) must be able to
-- perform the audited transitions; client roles never own tables. OPEN CHECK: confirm the owner role has BYPASSRLS in the target
-- Postgres/Supabase project and that no application connection uses the owner role (RLS test suite, db/tests).
do $$
declare t text;
begin
  for t in select unnest(array[
    'app_role','import_batch','import_checkpoint','import_error','source_record','source_record_revision','candidate',
    'source_candidate_map','duplicate_group','duplicate_group_member','merge_history','eligibility_evaluation','bulk_action',
    'review_decision','listing','takedown_request','suppression','audit_log'])
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- Reviewers (authenticated + app_role) may read the review layers through server-side code; writes go through
-- security-definer functions (to be added in 0002) that enforce state transitions and write audit_log.
create policy reviewer_read_candidate on candidate for select to authenticated using (is_reviewer());
create policy reviewer_read_eval on eligibility_evaluation for select to authenticated using (is_reviewer());
create policy reviewer_read_decisions on review_decision for select to authenticated using (is_reviewer());
grant select on candidate, eligibility_evaluation, review_decision to authenticated;

-- Public read model: only published, not unpublished, and only the tier-1/2 columns.
-- OPEN CHECK (cannot be verified without a running Postgres): `listing` has RLS enabled and no select policy for client roles;
-- this definer view returns rows because its owner bypasses RLS. Alternative if that is not acceptable: add an explicit select
-- policy on listing limited to unpublished_at is null and make the view security_invoker = true. Prove with the RLS test suite.
create view public_listing with (security_invoker = false) as
  select l.slug, l.title, l.summary, l.facts, l.evidence_level, l.evidence_checked_at, l.source_links, l.published_at
  from listing l
  join candidate c on c.id = l.candidate_id
  where l.unpublished_at is null
    and c.status = 'published'                       -- second, independent check: a withdrawn/suppressed candidate is never shown
    and c.importable
    and not is_suppressed(c.canonical_key);
grant select on public_listing to anon, authenticated;

-- source_record.raw, author_login, requester_contact and every import table remain unreachable from the client roles.

commit;
