# Proposed Database Schema and Migration Plan (Revision 5)

SQL: `db/migrations/0001` … `0006` (table below), tests in `db/tests/` (`npm run test:db`). **Executed on an in-process PostgreSQL (PGlite) only; not yet applied to a real Supabase/PostgreSQL server.** Apply to a new, empty staging database through a migration runner, re-run the suites, and resolve the open checks (owner-role `BYPASSRLS`, real `auth.uid()`, platform default privileges, query plans on the loaded dataset). The inherited `data/install.sql` is a design reference only and is not migrated or extended.

## 1. Layers and tables

| Layer | Tables | Purpose |
|---|---|---|
| Control | `import_batch`, `import_checkpoint`, `import_error` | batch id for every run (`full`/`incremental`/`dry_run`), per-stage resume checkpoints, errors with retry counts |
| Raw (internal only) | `source_record`, `source_record_revision` | source data as retrieved, unique on (repo, kind, GitHub id); `content_hash` detects edits and keeps prior versions; `rights_status` per record |
| Candidates | `candidate`, `source_candidate_map`, `duplicate_group`, `duplicate_group_member`, `merge_history` | canonical identity; **one disposition row per source record** (`mapped`, `no_identity`, `not_submission`, `code_contribution`, `context_comment`, `removal_request`, `link_correction`), only some pointing at a candidate; reversible merges with method, confidence and rationale |
| Evaluation | `eligibility_evaluation` | versioned machine verdict with rule IDs and evidence; one current row per candidate |
| Review | `review_decision`, `bulk_action`, `app_role`, `listing_draft` | every status change with reviewer and reason; bulk scope recorded and undoable; the reviewed text and minimum data that would be published |
| Publication | `listing`, `takedown_request`, `suppression`, `audit_log`, view `public_listing` | published listings (original summary + tier 1-2 facts), removal and re-import prevention, audit trail |

## 2. Separating importable, eligible and approved in the model

| Concept | Where it lives | Who can change it |
|---|---|---|
| importable | `candidate.importable` (+ `suppression`) | `import_upsert_candidate` may only lower it; suppression rows are created by reviewers |
| eligible | `eligibility_evaluation.category` (versioned, rule IDs, evidence) and the lifecycle statuses `eligible`/`needs_review`/`ineligible` | the evaluator; a reviewer override is a separate written `override_reason`, individual only |
| approved | `candidate.status = 'approved'` + `review_decision` + `audit_log` | only `review_candidate` / `apply_bulk_approval` (guard trigger rejects direct writes) |
| published | a `listing` row + status `published` | only `publish_listing` (guard trigger rejects direct inserts and checks gates again) |

`eligible_unblocked` (eligible, no security flag, no removal hold) is a **derived** property used for work queues and bulk lanes; it is never stored as a status and never means approval.

## 3. Status transitions (enforced in `_transition`)

```
candidate → eligible | needs_review | ineligible      (evaluator; import never changes status)
eligible | needs_review | ineligible | unavailable | rejected → approved   (approve; gates P1-P8 must pass; individual or bulk lane)
approved → published        (publish_listing; gates re-checked by listing_guard)
published → withdrawn       (unpublish)
any non-published → rejected | unavailable
rejected | withdrawn | unavailable → needs_review      (reopen)
```
Clearing a security flag or a removal hold (`clear_security_flag`, `clear_removal_hold`) are separate individual, audited functions; no bulk path exists.

## 4. Security model (mandatory, from the audit)

* RLS **enabled** on every table and every privilege revoked from `anon` and `authenticated`; the only client-readable object is `public_listing` (published, tier 1-2 columns, no raw data, no handles, no contact data). FORCE RLS is deliberately not used so that the owner role (which owns the security-definer functions) can perform the audited transitions; client roles never own tables. **Open check**: confirm the owner has `BYPASSRLS` in the target project and that no application connection uses it.
* Reviewers read review tables through policies keyed on `app_role`; every write goes through security-definer functions that check `is_reviewer()`, validate the transition, write `review_decision` and `audit_log`. No client key can write catalogue data.
* The service-role key lives only in the importer and server runtime, never in the browser bundle or repository.
* Removal path: `suppress_candidate` suppresses, marks the key non-importable, sets `listing.unpublished_at` and withdraws in one transaction; `unpublish` also sets `unpublished_at`; `public_listing` additionally requires `candidate.status = 'published'`, `importable` and `not is_suppressed(key)` (case-insensitive; also covers subpaths of a suppressed repository), so a withdrawn or suppressed listing cannot stay public. Open or accepted takedown requests (referencing the candidate or only its listing) block approval.
* Guards: `guard_candidate_status` (approved/published only inside a transition), `guard_listing` (approved candidate + gates), `import_upsert_candidate` (never touches status, can only lower `importable`).
* Constraints: unique canonical key; idempotent raw upsert key; `status = 'duplicate'` ⇔ `merged_into` set; approved/published require `importable`.

## 5. Migration plan

| Migration | Content | Status |
|---|---|---|
| 0001 | tables, enums, RLS default-deny, `public_listing` view | executed on PGlite; suppress/constraint defect fixed in 0002 |
| 0002 | `listing_draft`, `publication_gate_failures` (P1-P8), guard triggers, `import_upsert_candidate` (explicit grant to the importer role), transition, bulk, undo, clear and suppress functions | executed; gate-failure array-literal defect fixed |
| 0003 | `resolve_duplicate_group` (audited; clears gate P4 for ambiguity groups the loader creates) | executed |
| 0004 | takedown workflow (`record_takedown_request`, `verify_takedown_ownership`, `resolve_takedown_request`); `public_listing` now also requires `not removal_hold`; gates P3 and bulk approval ignore an accepted *correction* | executed |
| 0005 | `pg_trgm` GIN indexes for the catalogue search, ordering index, review-queue indexes | executed; planner use checked on 400 rows only |
| 0006 | `save_listing_draft`, `approve_listing_summaries` (gates P5, P6) | executed |
| later | submissions and owner claims (D3 of the checklist), scheduled re-check facts, API keys, feeds | not started |

Rules: forward-only files in version control; every migration runs in CI against an empty database and against the previous version with fixtures; rollback is a compensating migration or a restore of the staging snapshot, never an edit of an applied file; no manual schema changes.

## 6. Loading plan

1. Load the stratified sample (≈300 candidates) into staging; run the SQL tests and reconciliation; hand-check.
2. Load the full raw set; row counts must equal file counts (7,324 in the audit snapshot) and the unique key must show no duplicates.
3. Load candidates, mappings (a disposition for every source record), evaluations; reconciliation identities must hold on database counts.
4. Loading never sets `approved` or `published`; all candidates enter in a machine-determined non-approved status.

## 7. Open points

* Raw JSON in the main database or in restricted object storage, and the retention period (question Q1).
* Whether submitter handles are stored in `source_record` at all or only as salted hashes after attribution is no longer needed (Q2).
* Reviewer authentication provider and role administration.
* Owner-role RLS behaviour and `auth.uid()` semantics are assumptions until the SQL tests run on a real Postgres/Supabase.
