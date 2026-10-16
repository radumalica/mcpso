-- 0005_search_indexes.sql
-- Depends on 0001-0004. The public catalogue searches with `ilike '%term%'` on listing title and summary (via the public_listing view);
-- trigram GIN indexes make that scale. The review queue filters on candidate status and the evaluation lane.
begin;

create extension if not exists pg_trgm;

create index if not exists listing_title_trgm on listing using gin (title gin_trgm_ops);
create index if not exists listing_summary_trgm on listing using gin (summary gin_trgm_ops);
-- Catalogue ordering (title, slug) for visible rows.
create index if not exists listing_visible_title on listing (title, slug) where unpublished_at is null;

create index if not exists evaluation_lane on eligibility_evaluation ((evidence->>'lane')) where is_current;
create index if not exists candidate_review_queue on candidate (status, removal_hold) where status in ('candidate','needs_review','eligible','ineligible');

commit;
