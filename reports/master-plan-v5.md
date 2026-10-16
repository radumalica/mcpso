# Master Plan v5: independent MCP registry bootstrapped from the upstream addition requests

**Revision 5** (supersedes revisions 1-4; history in `master-plan-v5-changelog.md`). Companion documents: `import-count-reconciliation.md`, `publication-gate-checklist.md`, `mvp-feature-matrix.md`, `implementation-checklist.md`, `import-eligibility-policy.md`, `import-schema-and-migrations.md`, `import-data-flow.md`, `import-test-strategy-and-acceptance.md`, `risk-register.md`.

## 0. Settled decision (unchanged)

The registry is an **independently operated product** built by enhancing the current Apache-2.0 codebase, with its own brand, domain, repository, infrastructure, database, analytics, policies and data model. **The historical MCP server addition requests in `chatmcp/mcpso` are imported in full, deduplicated, evaluated, and selectively published in controlled batches after the mandatory gates pass.** This is not replaced by a curated-only launch. The importer and the review workflow are first-class priorities; the public launch scope is reduced so that they can be finished and the gates can be met by one engineer.

Independence: no runtime dependence on the upstream project; no upstream branding, name or tracking; no implied affiliation; Apache-2.0 obligations kept (`LICENSE`, `NOTICE`, modification notices); the code licence is not assumed to grant rights in submissions, descriptions, logos or screenshots (§8).

## 1. Critical review of revision 4 (what was wrong or missing)

| # | Finding | Evidence | Fixed in v5 |
|---|---|---|---|
| 1 | Count relationships were ambiguous and partly mislabelled: "197 renames merged" counted **repositories mapped**, not merges (235 records re-keyed, only 21 candidates actually joined by a rename); the merge-rule counts mixed units (R1/R4 per project, R2/R3/R5/R6 per record); ambiguity flag counts were entries, not projects; N6 "246" are reason entries over 196 projects | `dedup.mjs` code, `projects.jsonl`, `import-count-reconciliation.md` §3-4 | unit-explicit summaries, 41 identities, corrections table |
| 2 | "import-ready" was used as importable, eligible and approvable at once | field name in `classify.mjs`, plan text | three separate concepts in policy, schema, statuses, reports; field retired (`eligible_unblocked`) |
| 3 | The rev 4 reconciliation had a tautological identity and an invalid "exact/probable" split | `reconcile.mjs` rev 4 | rewritten; raw files recounted independently (T0a-d) |
| 4 | D7 (registry-only evidence) was left open while 1,029 eligible candidates depend on it | lane counts | resolved as a proposed default: levels 0/1/2, wording, never bulk (§5) |
| 5 | The publication boundary existed only as policy text | schema draft had no transition enforcement | gates as tested code plus DB guards/functions/tests (draft, unexecuted SQL) |
| 6 | Launch scope too large: many "P1" items were desirable, not necessary | rev 4 catalogue | MVP matrix (§6) |
| 7 | Rights workflow listed questions without owners or interim behaviour | policy §6 | Q1-Q7 with owner, blocking scope and interim safe behaviour |
| 8 | Phases lacked per-phase tests, rollback and launch-blocking flags | plan | `implementation-checklist.md` |
| 9 | Cross-identity links and renames are applied automatically (101 duplicate records, 21 joins) while the policy implied review | `dedup.mjs` | now explicit: auto-applied, recorded by rule, listed for confirmation, reversible |
| 10 | Source data characteristics not examined for drift | fresh collection | 8 new, 1 vanished, 3 edited issues in 2 h 20 min: content-hash revisions and a fixed cut-off are required |

## 2. Reconciled import counts (measured, 2026-10-16 09:58 UTC snapshot)

Full table, units and identities: `import-count-reconciliation.md` (39 checks pass). Reproduced from the raw snapshot with `tools/audit/reproduce-from-raw.sh` (all outputs IDENTICAL; enrichment taken as stored, not re-fetched). The historical "~2,900" estimate is not reproduced; its origin is unknown (the only nearby figure is a superseded partial dry run of eligible *projects*).

| Stage (unit) | Count |
|---|---|
| Raw source records (records) | 7,324 = 4,869 issues + 43 PRs + 2,412 comments |
| Normalised (records) | 6,362 (+ 962 context-only comments not normalised) |
| Relevant addition requests (records) | **6,149** = 6,052 placed + 97 unplaced |
| Canonical candidates (projects) | **4,868** = 6,052 − **1,184** duplicate records |
| Of which multi-record (projects) | 661 holding 1,845 records |
| Renames (repositories / records / candidates joined) | 197 / 235 / 21 |
| Ambiguous (projects) | **228** (227 needs review, 1 ineligible, 0 eligible) |
| Evaluation (projects) | eligible **3,502**, needs review **1,353**, ineligible **13** |
| eligible_unblocked (projects) | **3,467** (= 3,502 − 26 security-flagged − 9 removal-held) |
| Approval lanes (projects) | bulk 1,216; family-sample 302; individual 1,949; blocked 35 |
| Importable: source records with full provenance / candidates / suppressed | 7,324 of 7,324 / 4,868 / 0 |
| **Approved / published** | **0 / 0** |

Records not in the candidate count: 1,272 (97 unplaced + 213 non-submission + 962 context-only comments).

## 3. Concepts, statuses and transitions

Importable ≠ eligible ≠ approved. Lifecycle statuses: `candidate`, `needs_review`, `eligible`, `ineligible`, `duplicate`, `unavailable`, `approved`, `published`, `withdrawn`, `rejected`. Only audited functions may set `approved` and `published`; import never changes status. Details: `import-eligibility-policy.md` §1-2, `import-schema-and-migrations.md` §2-3.

## 4. Publication boundary (enforced, not only documented)

* Importing never auto-publishes: pipeline output has `approved_for_publication: false` always (tested); `import_upsert_candidate` never touches status.
* Gates P1-P8 (`publication-gate-checklist.md`) are evaluated by one function and re-checked at publication; guard triggers reject direct `UPDATE ... status = 'published'/'approved'` and direct `INSERT INTO listing`.
* Security flags, removal holds, suppression and rights restrictions cannot be bypassed by a bulk action or by a written override; clearing a flag or hold is an individual audited decision.
* Bulk actions: preview with the exact filter, count check, at most 500, all-or-nothing, recorded, undoable (refuses after publication until unpublished).
* Re-import cannot resurrect removed or suppressed candidates (suppression list consulted; `importable` can only be lowered by import).
* Only `public_listing` is client-readable; raw records, review metadata, handles and contact data are not exposed (client roles have no privileges on any other object).
* Evidence: JS gate logic and bulk guardrails are tested now (9 tests); the SQL enforcement and tests are **drafted but never executed**.

## 5. Evidence levels and wording (resolution of D7, proposed default)

Level 0 declared only (no resolved repository): individual approval only, hidden from the default catalogue, mandatory wording "Declared only ... not checked". Level 1 repository facts checked (evidence is a registry listing and/or a manifest file, i.e. the publisher's own declaration): individual approval, labelled "not tested or security-reviewed". Level 2 static inspection (an SDK dependency with server wording): eligible for bulk approval within lane rules. A manifest file alone does **not** reach level 2. Level 3 reserved. Forbidden words at launch: verified, safe, secure, trusted, recommended, star ratings. Measured on eligible candidates: 644 / 1,286 / 1,572 for levels 0 / 1 / 2 (levels 0+1 = the 1,930 candidates on cheap evidence). Owner confirmation required.

## 6. Reduced MVP

Launch contains: catalogue with pagination, search and essential filters; listing pages with source links, provenance and honest evidence status; authenticated submission with duplicate detection; the review workflow (merge/split, approve/reject, bulk with guardrails); correction and removal; authentication, server-side authorisation, audit logs, backups, monitoring; tests, CI, accessibility basics, correct error handling; plus security and legal gates. Full compatibility matrix, extensive install snippets, public API/export, feeds, badges, advisory intelligence, advanced ownership verification and similar items are **post-launch** (`mvp-feature-matrix.md`). Security and legal requirements stay launch gates.

## 7. Phases (one engineer; estimates unvalidated)

| Phase | Weeks (est.) | Main changes | Tests / acceptance | Blocking? |
|---|---|---|---|---|
| **A** Independent foundation and critical fixes | 3-4 | separate repo/accounts; `NOTICE`; remove branding/trackers/fake stars; lock write routes; upgrade stack; fix build; CI; headers/rate limits | CI green; every write route needs auth; no critical/high production advisories; no upstream identifiers | **yes** (before any deployment) |
| **B** Importer and data model | 5-6 | dry-run, batch ids, client/resume/idempotence tests, fixtures; apply and test migrations 0001-0002 on staging; loader; stratified sample hand-check | two runs create nothing new; interrupted run identical; reconcile exits 0 on DB counts; SQL boundary suite green | **yes** |
| **C** Full ingestion and review | 4-6 (+ review time) | cut-off, full run, reconciliation report, review by risk order, bulk approvals in ≤ 500 batches with strata checks | all ambiguous/flagged/held decided or deferred; counts reconcile to listings; zero listings with open flags | **yes** for publication |
| **D** Registry launch | 6-8 | review UI, public site, submission, correction/removal, ops, docs | gates LG1-LG10 | **yes** |
| **E** Advanced | after launch | per matrix | measured need | no |

Total about 18-24 weeks of engineering plus counsel and review time. Staging work (B, C up to the first publication) does not wait for counsel; any production raw load and any publication do (Q1-Q7). Data migration and rollback considerations per phase are in `implementation-checklist.md`.

## 8. Data rights and privacy (operational)

Technical ingestion (internal, restricted, staging first) is separate from public republication (identifying facts, short factual metadata, source links, original approved text). Third-party descriptions, comments, logos, screenshots and personal data stay out of public listings unless a decision permits them. Open questions block specific uses, not the import itself:

| Q | Question | Blocks | Resolver |
|---|---|---|---|
| Q1 | store third-party text/snippets: where, how long | production raw store | counsel + product owner |
| Q2 | attribution by handle; personal data; opt-out | public attribution | privacy advisor/counsel |
| Q3 | logos/screenshots | media on listings | counsel |
| Q4 | export/API terms | public export (post-launch) | product owner + counsel |
| Q5 | upstream terms; official-registry terms | registry reference, statements of origin | counsel |
| Q6 | takedown contact/jurisdiction | launch | counsel + product owner |
| Q7 | derivative summaries (template vs LLM) | summaries on listings | counsel + product owner |

Interim behaviour if unresolved: facts-only listings, repository-derived names, no handles/titles/prose/media, template summaries, no export. These are open questions, not conclusions.

## 9. Decisions needed

D1 name/domain; D2 stack/hosting; D3 official-registry stance (evidence reference only at launch); D4 governance and reviewer authentication; D5 rights/privacy (Q1-Q7); D6 no LLM public text at launch; **D7 evidence thresholds: proposed default in §5, owner to confirm**; D8 sustainability and cost estimate; D9 dataset cut-off and size of the first wave; D10 raw storage location and retention; **D11 exposure already in the pushed history**: earlier commits of the audit branch in the public fork contain submitter GitHub handles (about 2,800 distinct authors, in `normalized.csv` and several review lists). From this revision committed files carry no handles (reviewer-only copies live in ignored `private/` directories) and the reports name no accounts, but history cannot be rewritten without a force-push, which was not done. Whether to make the repository or branch private, or delete the branch, is the owner's decision.

## 10. Findings that cannot be verified here

* **Update (implementation, branch `impl/v5-phase-a`, see `implementation-log.md` items 8-20):** migrations 0001-0006 and their SQL and Node test suites now run on an in-process PostgreSQL (PGlite) and pass; executing them found and fixed five defects (suppression constraint, missing importer grant, gate-failure array literal, accepted corrections blocking forever, vacuous negative tests). They have **not** been applied to a real Supabase/PostgreSQL server: RLS owner-bypass, `auth.uid()` from a real JWT, platform default privileges and query plans on the loaded dataset remain assumptions.
* All legal and privacy conclusions: none are drawn; Q1-Q7 are open and need counsel.
* Origin of the "~2,900" estimate.
* Extraction and classification precision beyond fixed-seed hand-checked samples (71 projects, small).
* Freshness after the snapshot: only the collection stage was re-run on fresh data; enrichment and classification were reproduced from stored inputs, not re-fetched.
* Whether upstream edits and deletions are material to eligibility (3 edited bodies and 1 vanished issue were observed in 2 h 20 min, not analysed further).
* Reviewer throughput and calendar time are estimates.

## 11. Immediate next steps

1. Confirm D7, D9 and the MVP scope; engage counsel for Q1, Q2, Q6, Q7.
2. ~~Run migrations 0001-0002 on a disposable Postgres~~ done on PGlite (migrations 0001-0006); **next: apply them to an empty staging Supabase/Postgres and re-run the suites**.
3. Phase A on the product repository.
4. Importer hardening and client tests (Phase B), then the stratified sample.
5. Fix a cut-off date and run the full pipeline (Phase C); review in risk order; publish only after LG1-LG10.
