# Master Plan Change Log

Decisions that changed, in order. The latest user instruction always governs; earlier revisions are kept in version history, not reinstated.

| Rev | Date | Driver | Decision |
|---|---|---|---|
| 1 | 2026-10-16 | initial request for a master plan with missing/future features | harden the fork, **import the upstream dataset into a review queue**, rebrand |
| 2 | 2026-10-16 | "different product ... no relation to mcp.so", no upstream data | start from scratch, no upstream data, curated cold start |
| 3 | 2026-10-16 | "enhance the current codebase ... keep it as a separate application" | keep and incrementally migrate the Apache-2.0 code; separate repo/brand/accounts/database; still no upstream data |
| 4 | 2026-10-16 | explicit revision: import and evaluate the upstream addition requests; "do not silently reverse this decision or replace it with a curated-only launch" | **upstream import is a core first-class workstream and the initial data-acquisition strategy**; independent product and infrastructure kept; rights-aware handling |

## Changes from revision 3 to revision 4

| Topic | Rev 3 | Rev 4 |
|---|---|---|
| Upstream data | not used, never loaded | imported as internal raw source records, deduplicated and evaluated; published only after review, as facts + source links + original summaries |
| Cold start | curated seed set, outreach, official-registry cross-links | the import is the bootstrap; owner submissions, outreach, CI action and optional registry reference are additive |
| Phases | 0-5 (security, foundation, core, trust, differentiation, frontier) | **A** independent foundation and critical fixes; **B** importer and data model; **C** full ingestion and review; **D** registry launch; **E** advanced features |
| Schema | ownership/evidence/removal fields mentioned | concrete draft `db/migrations/0001_import_pipeline.sql`: batches, checkpoints, errors, raw source records with revisions, candidates, source→candidate map, duplicate groups, merge history, evaluations, review decisions, bulk actions, listings, takedowns, suppression, audit log; RLS default-deny |
| Statuses | eligible / needs_review / ineligible | `candidate`, `needs_review`, `eligible`, `ineligible`, `duplicate`, `published`, `rejected`, `unavailable` with entry/exit criteria |
| Count assumptions | none | the "~2,900" estimate is not a target; measured counts reported with reconciliation (4,869 issues, 43 PRs, 6,149 submission-type records, 4,868 candidates, 3,502 eligible, 3,467 import-ready, 0 published) |
| Rights | not addressed beyond a legal-operations item | three content tiers; no wholesale reproduction of third-party prose; takedown/suppression process; five open rights/privacy questions flagged and blocking first public publication |
| Review | reviewer UI in Phase 2 | interim scripted review workflow in Phase C, full admin UI in Phase D; bulk actions with preview, count check, undo, and strata limits |
| Prerequisites | advanced features gated by usage data | advanced features explicitly not a prerequisite for import and review |

## Unchanged from revisions 3 and 2

Own brand, domain, repository, infrastructure, analytics, credentials and policies; no runtime dependence on the upstream project; no upstream branding or implied affiliation; Apache-2.0 compliance (LICENSE, NOTICE, modification notices); audit security findings mandatory (no anonymous catalogue writes, RLS enforced, server-side authorisation, URL validation, rate limits, no unbounded external calls, no execution of imported code, safe rendering of untrusted metadata); "eligible" is never "verified" or "safe".
