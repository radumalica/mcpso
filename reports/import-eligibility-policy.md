# Import and Eligibility Policy (Revision 5)

Status: **proposed policy**, to be adopted by the registry owner. The machine-evaluated rules (E1-E4, N1-N9, I1-I3) are in `submission-eligibility-criteria.md` and are unchanged. This document defines the vocabulary, the separation of concepts, the automation boundaries and the data-rights handling. Eligibility is **not** verification and **not** a security review. Gate details, evidence wording and the rights workflow are in `publication-gate-checklist.md`.

## 1. Three separate concepts (never synonyms)

| Concept | Question it answers | Decided by | Reversible? |
|---|---|---|---|
| **Importable** | Can the source record be stored with the required provenance (repository, number, URL, retrieval time, batch id), and is the canonical key not suppressed? | importer | yes (suppression) |
| **Eligible for publication** | Does the candidate meet the inclusion criteria? | machine evaluator, rule IDs and evidence stored; reviewer may override only in writing and only individually | yes (re-evaluation) |
| **Approved for publication** | Has a human approved it and do all publication gates P1-P8 pass? | reviewer, via audited transition functions | yes (unpublish/withdraw) |

The old name `import-ready` is retired. The pipeline field `eligible_unblocked` means "eligible, no security flag, no removal hold" and nothing more. It is **not** approval and **not** importability. Counts (audit snapshot): importable 4,868; eligible 3,502; eligible_unblocked 3,467; approved 0.

## 2. Candidate lifecycle statuses

| Status | Meaning | Entered by | Leaves by |
|---|---|---|---|
| `candidate` | canonical candidate exists, not yet evaluated | importer | evaluation |
| `needs_review` | uncertain or held: N-rules, ambiguity, security flag, removal hold | evaluator | reviewer decision |
| `eligible` | passes the criteria; **not approved** | evaluator | reviewer approve/reject |
| `ineligible` | positive evidence it is out of scope (I1 registry infrastructure, I2 empty/template repo, I3 no MCP signal) | evaluator | reviewer may overturn with reason |
| `duplicate` | a candidate merged into another by a **reviewer** merge (`merged_into`); reversible via merge history. Automatic deduplication does not produce this status: it maps duplicate *records* (1,184) to their canonical candidate, so no candidate in the audit data has this status yet | reviewer | undo merge |
| `unavailable` | repository 404/private/deleted on two checks at least 7 days apart, or archived with no successor | evaluator (second confirmation) or reviewer | re-check succeeds |
| `approved` | human decision recorded and gates P1-P8 pass; **no listing exists yet** | reviewer only | publish, reject, or unpublish path |
| `published` | a `listing` row exists | `publish_listing` only | `unpublish` → `withdrawn` |
| `withdrawn` | previously published, taken down | reviewer or takedown | reopen |
| `rejected` | a human decided not to list it (reason required) | reviewer | reopen |

Transitions into `approved` and `published` are possible **only** through the audited functions (database guard triggers reject direct writes). Import never changes a candidate's status, never approves, never publishes.

## 3. Evidence available to the evaluator

Only without executing anything: GitHub API facts (exists, public, archived, fork, template, empty, licence SPDX, last push, topics, README presence), manifest files read through the API (`server.json`, `package.json` `mcpName`, SDK dependencies, scoped to the claimed subpath), README wording, and matches against the official MCP Registry used as an **external reference only**. Stars, popularity and README length are never evidence of correctness or safety. Imported code is never executed, installed or built.

## 4. Resolution of D7: weak or declaration-only evidence

Candidates whose evidence is a registry listing and/or a manifest file only (1,930 of 3,502 eligible: 644 with no resolved repository = level 0, 1,286 with a resolved repository but no SDK dependency = level 1) are **eligible but not approvable in bulk**: a registry entry and a `server.json`/`mcpName` field are both the publisher's own declaration. They may be published only after an individual approval, at evidence level 0 or 1, with the required wording ("Declared only ..." or "Repository facts checked ..."); level 0 entries are excluded from the default catalogue view. Level 2 (1,572 eligible) requires an SDK dependency with server wording. Full table in `publication-gate-checklist.md` §2. Proposed default; the owner must confirm.

## 5. Automation boundaries

| Stage | Automated | Human approval |
|---|---|---|
| Retrieve, normalise | yes | no |
| Deduplicate: identical canonical keys and same-record exact identifiers | yes, reversible | no |
| Deduplicate: cross-identity links (R2/R3/R5) and renames (R6) | applied automatically by the current pipeline (101 duplicate records; 21 candidates joined by a rename), each recorded with its rule; all are listed for reviewer confirmation and are reversible | confirmation of the auto-links; **ambiguity (228 candidates) is only flagged, never merged**, and needs a human decision |
| Evaluate eligibility | yes | no |
| Bulk reject (I1/I2 only) | proposes | yes, with scope preview |
| Approve | **never automatic** | yes; bulk allowed only in lane `bulk` (and sampled `family_sample`) |
| Clear a security flag or removal hold | **never automatic, never bulk** | individual reviewer decision with reason |
| Summary text | template from facts | approved text only; no LLM text at launch |
| Takedown, correction, suppression | no | yes |

Bulk guardrails (preview, count check, bound of 500, all-or-nothing, undo, exclusions that cannot be bypassed) are in `publication-gate-checklist.md` §3 and are enforced in code (`lib/gates.mjs`, `0002_publication_boundary.sql`).

## 6. Content rights and privacy

Technical ingestion is separated from public republication. The importer may retain source records **internally** (restricted, never served) so that decisions are auditable; public pages carry only identifying facts, short factual metadata, source links and original, approved text. The field-by-field table and the open questions Q1-Q7, with the owner who must resolve each, are in `publication-gate-checklist.md` §5. Third-party descriptions, comments, logos, screenshots and personal data stay out of public listings unless the applicable decision permits them; until then the interim behaviour in that table applies. The import is **not** paused by these questions: raw data may be processed on the local/staging snapshot; what is blocked is any production raw store (Q1) and any public use of a field class whose question is open.

**Takedown, correction, removal.** A published contact (Q6); ownership proof by GitHub permission on the repository (domain proof is post-launch); a removal hold applies immediately to the matched candidate and blocks approval; a decision creates a `suppression` row keyed by canonical key so that re-importing cannot resurrect it (`import_upsert_candidate` can only lower `importable`, never raise it, and never touches status); corrections are applied as audited `correct_metadata` decisions. Proposed targets: acknowledge within 3 working days, decide within 14. Seven removal requests exist in the audited data; one maps to a project with a strong basis and six are unmapped, so the affected candidates and every candidate whose own issue contains removal-like wording (19 projects, 9 of them eligible) are held.

## 7. Source records

* Only **issues** (and comments on the submission thread #1) are submissions; **pull requests** are code contributions and kept as provenance only.
* Every source record has exactly one disposition row in `source_candidate_map` (`mapped`, `no_identity`, `not_submission`, `code_contribution`, `context_comment`, `removal_request`, `link_correction`); only `mapped` records (6,052) point at a candidate.
* Edited or vanished upstream records: content-hash revisions are stored, vanished records are marked, not deleted. In a 2 h 20 min comparison, 8 issues appeared, 1 vanished and 3 bodies were edited.
* 595 issue numbers in the collected range are unretrievable and are listed, not guessed.
* Untrusted text is data: sanitised on render, never executed, never treated as instructions.

## 8. Runtime independence

The importer is an offline batch tool. The running application never calls the upstream project's API or infrastructure; refreshes query GitHub for the candidate's own repository with caching, bounded concurrency and rate-limit handling.
