# Ordered Implementation Checklist (Revision 5)

For one engineer. Order is strict unless a dependency says otherwise. Effort figures are unvalidated estimates in working weeks. `[x]` = done on the audit branch (executed or tested); `[ ]` = to do. Nothing here publishes, deploys or loads production data without explicit approval. "Blocking" means public launch cannot happen before the phase's blocking items are complete.

Legend for each phase: **Changes** (code/schema), **Deps** (prerequisites), **Tests**, **Acceptance** (testable), **Migration/rollback**, **Blocking?**.

---

## Phase A: Independent foundation and critical fixes (≈ 3-4 weeks) , blocking for any deployment

**Changes**
- [ ] A1 Create the product repository from the current code (separate application); keep `LICENSE`; add `NOTICE` (attribution to the original project, statement of modifications); mark modified files; verify the licence of `templates/tailspark` (none found) or replace it.
- [ ] A2 New cloud accounts, database project, secrets manager, analytics decision (none/cookieless), deployment config. No credential reused from any prior deployment.
- [ ] A3 Remove inherited branding, GA/AdSense IDs, `ads.txt`, fake 5-star, upstream policies, upstream contact addresses (audit R04).
- [ ] A4 Remove/lock public write and LLM-trigger routes (R01); server-side validation with allow-listed fields and exact hostname parsing (F-02); correct HTTP status codes (Q-05).
- [ ] A5 Upgrade `next`/`react` to a supported release, remove `vercel` and the deprecated Cloudflare adapter, one lockfile (R02); fix the type error and the build (R03); CI: typecheck, lint, tests, `audit`, secret scan.
- [ ] A6 Security headers, rate limiting, request-size limits (R12).

**Deps** decisions D1 (name/domain), D2 (stack/hosting).
**Tests** CI green on a clean checkout; authorisation tests for every write route (anonymous → 401/403); URL-validation regression tests (`github.com.evil.example`); dependency audit gate.
**Acceptance** `npm ci` (or the chosen manager) succeeds and `build` passes; no route performs a catalogue write without authentication; no critical/high production advisories; no upstream names/IDs in the tree (grep gate in CI); `NOTICE` present.
**Migration/rollback** none yet (no data). Rollback = redeploy previous build; keep the audit fork untouched.
**Blocking?** yes (LG1, LG9).

## Phase B: Importer and data model (≈ 5-6 weeks) , blocking

**Changes**
- [x] B1 Collector (paginated, rate-limit aware, backoff, resumable, incremental watermark), normaliser, deduplicator (unit-explicit statistics), GraphQL enrichment (no code execution, no install), classifier (rules, security flags, removal hold, suppression input), approval lanes, reconciliation (39 identities), reproduce-from-raw script. 55 importer tests pass.
- [x] B2 Publication-gate logic and bounded bulk actions as tested pure functions (`lib/gates.mjs`, 9 tests).
- [x] B3 Draft migrations `0001_import_pipeline.sql`, `0002_publication_boundary.sql` and draft SQL tests (**not applied or executed**).
- [ ] B4 Importer hardening: `--dry-run` (writes nothing, prints the report); `import_batch` id on every output record; per-record `fetched_at`; errors written with retry counts; content-hash revisions for edited/vanished records (the fresh collection showed 8 new, 1 vanished and 3 edited issues in 2 h 20 min).
- [ ] B5 Tests for the GitHub client against a local fake server: pagination (3 pages), `Retry-After` and rate-limit reset (fake clock), 5xx-then-success, permanent 404 not retried forever, malformed/truncated JSON, token never in logs; collector interruption/resume byte-identical; double run creates nothing new; incremental update stores a revision.
- [ ] B6 Synthetic fixture set (≈200 records, no real third-party text) covering every edge case: renames, forks, subpaths, ambiguous packages, hidden Unicode, removal requests, suppression, empty bodies.
- [ ] B7 Review and apply migrations 0001-0002 to an **empty staging** database through a migration runner; run `db/tests/publication_boundary.test.sql`; resolve the open checks (owner role bypass, view/RLS behaviour) found by the run.
- [ ] B8 Loader: raw → `source_record` (upsert on (repo, kind, GitHub id)), candidates via `import_upsert_candidate`, `source_candidate_map` with a disposition row for **every** source record, evaluations; reconciliation run against the database counts.
- [ ] B9 Stratified sample (≈300 candidates across year, identity type, hosting, flags, evidence level, lane) loaded to staging; hand-check per stratum (k of n); fix defects before the full run.

**Deps** Phase A for the application; B7 needs a staging Postgres; decisions D5 (rights) before any production raw load (Q1).
**Tests** all of B5-B8; DB constraint and RLS suite; reconcile identities on the database (`select count` equals file counts).
**Acceptance** two consecutive runs yield zero new rows and identical outputs; an interrupted run resumes to identical output; dry-run writes nothing; every source record has exactly one disposition row; reconcile exits 0; boundary SQL suite green on staging; no outbound host other than `api.github.com` (+ read-only registry host if enabled); static check that importer modules contain no `child_process`/`eval`/package-manager invocation.
**Migration/rollback** migrations are forward-only files; each tested from empty and from the previous version with fixtures; rollback = restore the staging snapshot or apply a compensating migration, never edit an applied file; the loader is idempotent so a failed load can be re-run.
**Blocking?** yes (the dataset cannot be reviewed without it).

## Phase C: Full ingestion and review (≈ 4-6 weeks incl. review time) , blocking for publication, not for staging

- [ ] C1 Decide the dataset cut-off date (D9); run the collector (incremental on top of the snapshot) and the full pipeline; produce `reconciliation.md`; list unretrievable records.
- [ ] C2 Interim review workflow before the UI exists: exported queues (CSV of ids, lane, reason rules) + scripts that call the transition functions; every decision recorded with a reason.
- [ ] C3 Review order: ambiguous groups and duplicate pairs → security-flagged → removal-held → needs_review by volume (N1 357, N2 221, N3 279, N7 194, N6 196, N9 73 ...) → individual lane (1,061) → family-sample audits (382) → bulk lane (2,024).
- [ ] C4 Hand-check strata for the bulk lane (stratified, fixed seed); proceed only if no stratum shows a clear false-positive rate above 5%.
- [ ] C5 Templates for facts-only summaries approved; reviewer-written summaries where needed; rights flags set.
- [ ] C6 Approve in bounded batches (≤ 500) with preview, count check and recorded decisions; **publish nothing until Phase D gates LG1-LG10 pass**; publish the first wave in controlled batches.

**Deps** Phase B; Q1, Q2, Q6, Q7 decided or interim restrictions in force.
**Tests** reconcile exits 0 on the final dataset; boundary tests green; sampled hand-check results recorded.
**Acceptance** all ambiguous groups, security-flagged and removal-held candidates have a recorded decision or an explicit deferral; counts reconcile from source records through candidates and statuses to listings; zero listings with unresolved rights, security or removal flags.
**Migration/rollback** every approval batch is a `bulk_action` that can be undone; unpublish and suppression paths verified before the first publish; database backup taken and a restore drill performed before the first production load.
**Blocking?** yes for the first publication.

## Phase D: Registry launch (≈ 6-8 weeks) , blocking

- [ ] D1 Review UI: queue filters, source records and duplicate groups, side-by-side compare, merge/split, why-panel, metadata correction, bulk actions with preview/count/undo (replaces the interim scripts).
- [ ] D2 Public site: catalogue with pagination, search, essential filters; listing pages with evidence level and required wording; correct 404/500 handling; mobile navigation; accessibility basics.
- [ ] D3 Authenticated submission with validation and duplicate detection; status page for submitters.
- [ ] D4 Correction and removal workflow with ownership check; suppression list consulted by the importer; public changelog of removals.
- [ ] D5 Operations: backups with a performed restore drill, monitoring and alerts, structured logs without personal data, runbooks.
- [ ] D6 Documentation pages: criteria, evidence levels, takedown process, non-affiliation statement.

**Deps** Phases A-C; counsel sign-off (LG4).
**Tests** e2e for submit → review → approve → publish → remove; accessibility checks; authorisation tests; public API/read model returns only `public_listing` columns; direct status/listing writes rejected.
**Acceptance** gates LG1-LG10 in `publication-gate-checklist.md` all pass.
**Migration/rollback** feature flags for public pages; DB migrations 0003+ as above; rollback = unpublish batches (reversible) and redeploy the previous build.
**Blocking?** yes.

## Phase E: Advanced features , not blocking

See `mvp-feature-matrix.md` §2-3. Start only after launch, one item at a time, each with measured need, tests and its own threat model where it executes or fetches anything.

---

## Cross-cutting checks run at every phase gate
- [x] `node --test tools/upstream-import/test/*.test.mjs` (55 pass) and `tools/upstream-import/reconcile.mjs` exits 0.
- [x] `tools/audit/reproduce-from-raw.sh` reports IDENTICAL for the stored dataset.
- [ ] Secret scan clean, no credentials in the repository or logs.
- [ ] Dependency audit has no critical/high production advisories.
