# Import Count Reconciliation (Revision 5)

Grounded in the stored artifacts of the 2026-10-16 09:58 UTC collection: `data/upstream-import/{collect-manifest.json, normalized/normalize-summary.json, dedup/dedup-summary.json, classified/classification-summary.json, classified/approval-lanes-summary.json, reconciliation.json}` and the code that produced them (`collect.mjs`, `normalize.mjs`, `dedup.mjs`, `enrich.mjs`, `classify.mjs`, `lib/gates.mjs`, `approval_lanes.mjs`, `reconcile.mjs`). Every row below is checked by `tools/upstream-import/reconcile.mjs` (39 identities, all passing; 55 tests). **No number was changed to make the arithmetic work**; where an earlier report labelled a figure wrongly, the label is corrected (§4), not the figure.

## 1. What each number counts (units)

The earlier confusion came from mixing units: **records** (source issues/comments), **projects** (canonical candidates), **repositories**, **merge annotations** and **reason entries**.

| Figure | Unit | Value |
|---|---|---|
| Raw source records | records | 7,324 = 4,869 issues + 43 PRs + 2,412 comments |
| Normalised records | records | 6,362 = 4,869 issues + 43 PRs + 1,450 submission-thread comments |
| Context-only comments (stored, not normalised) | records | 962 |
| **Relevant addition requests** | records | **6,149** = 4,754 issues + 1,395 thread comments with intent submission / submission_unclear |
| Placed records (usable identity) | records | 6,052 |
| Unplaced records (no identity) | records | 97 |
| Non-submission records | records | 213 (no identity 110, questions 48, PRs 43, removals 7, link corrections 5) |
| **Canonical candidates** | projects | **4,868** |
| **Duplicate records merged** | records | **1,184** (= 6,052 − 4,868) |
| Multi-record projects | projects | 661 (hold 1,845 records = 661 + 1,184) |
| Renames mapped by GitHub | repositories | **197** |
| Records re-keyed by those renames | records | 235 |
| Projects joined **because of** a rename | projects | 21 |
| **Ambiguous cases** | projects | **228** |
| Eligible / needs review / ineligible | projects | 3,502 / 1,353 / 13 |
| **eligible_unblocked** (formerly "import-ready") | projects | **3,467** |

## 2. Stage transitions (all reconcile)

| # | Transition | Arithmetic | Notes |
|---|---|---|---|
| T1/T2 | raw → normalised | 7,324 = 6,362 + 962 | the 962 are comments outside the submission thread |
| T2 | normalised composition | 6,362 = 4,869 + 43 + 1,450 | independent recount of the raw files agrees (T0a-d) |
| T4 | normalised → intent | 6,362 = 6,149 submission-type + 213 non-submission | |
| T5 | submission-type → identity | 6,149 = 6,052 placed + 97 unplaced | the 97 are **excluded from the candidate count** and listed for manual review (`dedup/unresolved-submissions.jsonl`) |
| T6 | placed records → candidates | 6,052 = 4,868 projects + 1,184 duplicate records | a project's first record is the candidate; the others are duplicates; no record is in two projects (6,052 distinct) |
| T6b/c | by project size | 6,052 = 4,207 single-record projects + 1,845 records in 661 multi-record projects; 1,845 = 661 + 1,184 | |
| T7 | duplicate records by basis | 1,184 = 1,083 same canonical key + 42 via R6 (rename) + 26 via R3 (endpoint) + 22 via R5 (package) + 11 via R2 (package→repo) | each duplicate record has exactly one basis |
| T8 | multi-record projects | 661 = 624 GitHub identity (R1) + 37 endpoint/package identity (R4) | R1/R4 entries are **one per project**, not per record |
| T10 | candidates → category | 4,868 = 3,502 + 1,353 + 13 | partition; exactly one category per project |
| T10b/c | category composition | needs_review 1,353 = N1 357 + N2 221 + N3 279 + N4 6 + N5 3 + N6 196 + N7 194 + N8 24 + N9 73 (first rule); ineligible 13 = I1 1 + I2 1 + I3 11 | |
| T11 | ambiguity | 228 ambiguous = 227 needs_review + 1 ineligible + **0 eligible** | no ambiguous candidate is eligible |
| T12 | eligible → unblocked | 3,502 = 3,467 + 26 security-flagged + 9 removal-held (+ 0 both) | |
| T15 | unblocked → approval lanes | 3,467 = 2,024 bulk + 382 family-sample + 1,061 individual; blocked 35 = 26 + 9 | lanes describe *how* a human may approve; they approve nothing |
| T13/T14 | importable / approved | importable 4,868; suppressed 0; **approved 0; published 0** | review has not started |

**Source records not in the candidate count: 1,272** = 97 unplaced + 213 non-submission + 962 context-only comments (7,324 − 6,052). Pull requests (43) are among the non-submission records and are kept as provenance only.

## 3. How the merge and rename categories relate

* **Do they overlap?** The categories are *annotations on different units*, so they overlap and must not be added together. R1/R4 label whole multi-record projects (661). R2/R3/R5/R6 annotate individual records; 101 of the 1,184 duplicate records carry one (each carries exactly one). The 1,083 remaining duplicates share the project's exact canonical key.
* **Records or operations?** There are no "merge operations" in the data. The 1,184 are **records**; the 976 `merge_reasons` entries in `dedup/projects.jsonl` (R1 624, R4 37, R2 16, R3 42, R5 22, R6 235) are annotation entries of mixed units and are not a count of merges (an earlier reconciliation revision wrongly summed them into "exact 683 / probable 293"; removed).
* **197 renames.** `renames_applied` counted **repositories** whose GitHub-resolved owner/name differs from the submitted one. They re-keyed 235 records in 194 projects. Only 39 of those projects hold more than one record, and in only **21** did the rename make previously different keys equal (i.e. it caused a merge). Reports that said "197 renames merged" were wrong; the correct statement is "197 renamed repositories mapped, 21 candidates formed by joining records across a rename".
* **228 ambiguous.** Distinct projects flagged by deduplication (not merged): shared package across repositories 139, shared endpoint across repositories 73, same repository with incompatible names 28 (11 projects carry more than one flag; `monorepo_subpath_project`, 100 projects, is informational and excluded). 196 of them received review rule N6 (246 N6 reason entries, because N6 is recorded once per flag); the other 32 were decided first by another rule (N2 unresolved repository 21, N1 weak signals 9, I1 1, N4 fork 1); none is eligible.
* **Excluded vs excluded-by-evaluation.** Excluded from the candidate count: 97 unplaced records. Excluded from approval: 1,353 needs_review + 13 ineligible + 35 blocked.

## 4. Corrections to earlier statements

| Earlier statement (where) | Correction |
|---|---|
| "197 renames/transfers merged" (dataset analysis, rev 4 plan) | 197 repositories mapped; 235 records re-keyed; 21 projects joined by a rename |
| "merge rules used: R1 624, R6 235 ..." presented as merge decisions | annotation entries of mixed units; use the unit-explicit fields in `dedup-summary.json` |
| "ambiguity flags: shared package 157, shared endpoint 93, monorepo 100, incompatible names 28" (dataset analysis) | those were flag *entries*; distinct projects are 139 / 73 / 100 / 28 |
| "N6: 196 (246 including secondary reasons)" | 196 projects, 246 reason entries (several per project); not secondary reasons of other projects |
| "import-ready 3,467" | renamed `eligible_unblocked`; it means eligible and not blocked, **not** importable and **not** approved |
| "exact 683 / probable 293 merge decisions" (reconcile rev 4 output) | removed; see §3 |

## 5. Reproducibility and drift

* **Reproduced from the raw snapshot:** `tools/audit/reproduce-from-raw.sh` re-runs normalise → dedup → classify → approval lanes → reconcile into a scratch directory from the stored raw files (GitHub enrichment and the 44,497-entry registry snapshot taken as stored inputs, not re-fetched). Result: all four summaries and the normalised, project and classified row sets are **identical**. The earlier results are therefore reproducible from the raw snapshot; the enrichment stage was not re-run.
* **Fresh collection (2026-10-16 12:19 UTC, 2 h 20 min after the snapshot), collection stage only:** issues 4,876 (8 new, **1 disappeared**), comments 2,413 (+1), PRs 43; **3 issue bodies were edited**, no titles or states changed. So the upstream tracker drifts: new records arrive, records vanish and bodies are edited within hours. The full pipeline was not re-run on the fresh data; the reviewed basis stays the 09:58 UTC snapshot until a cut-off date is chosen (decision D9). Incremental sync with content-hash revisions is required for Phase B.
* **Not verified:** the origin of the historical "~2,900" estimate (see `import-data-flow.md`); true precision of extraction and classification (hand-checked samples only); completeness against records deleted before collection (595 issue numbers are unretrievable).

## 6. Definitions of the three separate concepts

| Concept | Meaning | Count now |
|---|---|---|
| **Importable** | the source record(s) can be stored with the required provenance and the key is not suppressed | 4,868 candidates (all); 0 suppressed |
| **Eligible for publication** | the candidate meets the inclusion criteria (machine verdict, rule IDs stored) | 3,502 eligible; 3,467 of them unblocked |
| **Approved for publication** | a human decision is recorded and gates P1-P8 passed (`publication-gate-checklist.md`) | **0** |
