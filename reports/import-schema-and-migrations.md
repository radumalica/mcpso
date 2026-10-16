# Proposed Database Schema and Migration Plan

Draft SQL: `db/migrations/0001_import_pipeline.sql` (**not applied and not validated**: no Postgres server was available when it was written; run it only against a new empty database through a migration runner, then run the RLS test suite described below). The existing `data/install.sql` of the inherited app is a design reference only and is not migrated or extended.

## 1. Layers and tables

| Layer | Tables | Purpose |
|---|---|---|
| Control | `import_batch`, `import_checkpoint`, `import_error` | batch id for every run (`full`/`incremental`/`dry_run`), per-stage resume checkpoints, errors with retry counts |
| Raw | `source_record`, `source_record_revision` | source data as retrieved, unique on (repo, kind, GitHub id); `content_hash` detects edits and keeps prior versions; `rights_status` per record; **internal only** |
| Candidates | `candidate`, `source_candidate_map`, `duplicate_group`, `duplicate_group_member`, `merge_history` | canonical identity, auditable mapping from every source record (including rejected/merged candidates), reversible merges with method, confidence, rationale |
| Evaluation | `eligibility_evaluation` | versioned rule results with rule IDs and evidence; one current row per candidate |
| Review | `review_decision`, `bulk_action`, `app_role` | every status change with reviewer and reason; bulk scope recorded and undoable |
| Publication | `listing`, `takedown_request`, `suppression`, `audit_log`, view `public_listing` | published listings with original summary and tier 1-2 facts; removal and re-import prevention; general audit trail |

Provenance fields retained as required: retrieval date (`fetched_at`), source repository, source number and URL, batch id (`first_batch_id`, `last_batch_id`).

## 2. Security model (mandatory, from the audit)

* RLS **enabled and forced** on every table; all privileges revoked from `anon` and `authenticated`; the only client-readable object is the `public_listing` view (published, tier 1-2 fields, no raw data, no author handles, no contact data).
* Reviewers read review tables through RLS policies keyed on `app_role`; **all writes go through server-side code / security-definer functions (migration 0002)** that enforce allowed status transitions and write `audit_log`. No client key can write catalog data.
* The service-role key exists only in the importer and server runtime, never in the browser bundle or repository; secrets from environment variables.
* Constraint `candidate.status = 'duplicate'` ⇔ `merged_into` set; unique canonical key; idempotent raw upsert key.

## 3. Migration plan

| Migration | Content | Gate before applying |
|---|---|---|
| 0001 (drafted) | all tables above, RLS default-deny, `public_listing` view | SQL reviewed by a second person; applied to an empty staging database in CI |
| 0002 | state-transition functions (`review_candidate`, `apply_bulk_action`, `undo_bulk_action`, `publish_listing`, `unpublish_listing`), audit triggers, `suppression` check on candidate insert | transition tests green |
| 0003 | search structures (tsvector/trigram on listing title/summary/facts), indexes for the review queue filters | query plans checked on the loaded dataset |
| 0004 | owner accounts and claims (ownership proof) | after Phase D |
| later | evidence/inspection tables, API keys, feeds | per roadmap |

Rules: migrations are forward-only files in version control; no manual schema edits; every migration runs in CI against an empty database and against the previous version with seeded fixtures; rollback is a documented compensating migration, never an edit of an applied file.

## 4. Loading plan

1. Load the sample (≈200 records incl. all edge cases) into staging; run reconciliation; review.
2. Load the full raw set; verify row counts equal the file counts and `source_record` has no duplicates for the unique key.
3. Load candidates, mapping and evaluation from the pipeline output; reconciliation identities must hold.
4. Nothing is `published` by loading: all candidates enter as `candidate`, `needs_review`, `eligible`, `ineligible` or `duplicate`.

## 5. Open points

* Whether raw JSON bodies live in the main database or in restricted object storage (retention and access trade-off; legal question 1 in the policy).
* Whether author handles are stored in `source_record` at all or only as salted hashes after attribution is no longer needed (privacy question 2).
* Reviewer authentication provider and role administration process.
