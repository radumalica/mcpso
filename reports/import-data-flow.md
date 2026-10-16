# Import Data Flow

Counts shown are the **measured** results of the audit run on 2026-10-16 (`data/upstream-import/reconciliation.md`); a new run will differ because upstream keeps growing. The earlier historical estimate of about 2,900 requests is not reproduced: the measured figures are 4,869 issues, 43 pull requests and 4,868 canonical candidates (see §3).

## 1. Diagram

```mermaid
flowchart TD
  GH[(GitHub REST API: chatmcp/mcpso<br/>issues, PRs, comments)] -->|1 collect: paginated, resumable,<br/>rate-limit aware, batch id| RAW[(source_record + revisions<br/>RAW, internal only)]
  RAW -->|2 normalise: extract identity and facts,<br/>classify intent| NORM[normalised records<br/>6,362 = 4,869 issues + 43 PRs + 1,450 thread comments]
  NORM -->|submission-type: 6,149| ID{identity found?}
  ID -- no: 97 --> UNK[unresolved list for review]
  ID -- yes: 6,052 --> DEDUP[3 deduplicate<br/>exact / high / probable rules]
  DEDUP -->|1,184 duplicate records merged| MAP[(source_candidate_map<br/>one disposition per record;<br/>6,052 mapped to a candidate)]
  DEDUP --> CAND[(candidate: 4,868 canonical)]
  NORM -->|non-submission: 213<br/>removals 7, link corrections 5, PRs 43| SIDE[side queues: removal holds,<br/>link corrections, provenance only]
  SIDE -->|map to candidates, never auto-suppress| CAND
  CAND --> ENR[4 enrich: GitHub GraphQL facts,<br/>manifest files, official-registry reference<br/>NO code execution, NO install]
  ENR --> EVAL[5 evaluate: rules E1-E4 N1-N9 I1-I3<br/>+ security flags + holds]
  EVAL -->|eligible 3,502| ELIG[eligible]
  EVAL -->|needs_review 1,353| REV[needs_review]
  EVAL -->|ineligible 13| INEL[ineligible]
  ELIG --> Q[6 review queue<br/>filters, duplicate compare, why-panel]
  REV --> Q
  INEL --> Q
  Q -->|human decision<br/>approve / reject / merge / split / unavailable| DEC[(review_decision + audit_log<br/>bulk_action, undoable)]
  DEC --> GATE{7 publication gates P1-P7<br/>rights, security, removal, summary}
  GATE -- pass --> LIST[(listing: published,<br/>original summary + tier 1-2 facts + source links)]
  GATE -- fail --> Q
  TD[takedown / correction / removal request] --> SUP[(suppression list)]
  SUP -->|checked on every import| DEDUP
  TD --> DEC
  LIST --> PUB[public site / API<br/>read model only]
```

ASCII equivalent (stages and gates):

```
GitHub API --1 collect--> source_record (raw, internal)
   --2 normalise--> records --3 dedup--> candidates + source_candidate_map
   --4 enrich (read-only API, no code run)--> --5 evaluate--> eligible | needs_review | ineligible
   --6 review queue (human)--> review_decision/audit --7 gates P1..P7--> listing (published)
 takedown/removal --> suppression --checked by--> every future import
```

## 2. Stage contract

| # | Stage | Input → output | Automated? | Idempotency / safety |
|---|---|---|---|---|
| 1 | Collect | API pages → `source_record`, `import_batch`, `import_checkpoint`, `import_error` | yes | keyed by (repo, kind, GitHub id); upsert; changed content hash stores a revision; bounded concurrency; backoff with jitter; `--incremental` by watermark; dry-run writes nothing |
| 2 | Normalise | raw → records with claims, intent, security flags | yes | pure function of raw; reruns overwrite derived rows only |
| 3 | Deduplicate | records → candidates + mapping + duplicate groups | rules yes; uncertain matches proposed | reversible merges (`merge_history`); never merges on name similarity alone |
| 4 | Enrich | candidates → repository facts, manifest evidence, registry reference | yes | API-only, cached, resumable, one query per project key; no clone, no install, no execution |
| 5 | Evaluate | facts → category, rule IDs, evidence, quality and security flags | yes | versioned evaluator; `is_current` evaluation per candidate |
| 6 | Review | queue → decisions | **human** | audit log; bulk actions previewed and undoable |
| 7 | Publish | approved → `listing` | **human approval + gates** | rights tiers; original summaries; suppression list consulted |

## 3. Reconciliation (measured, audit run)

Units, relationships and all 39 stage identities: `import-count-reconciliation.md`. In the flow above, "importable", "eligible" and "approved" are three separate states; the gate between review and publication (P1-P8) is enforced in the database (`db/migrations/0002_publication_boundary.sql`), not in the UI.

| Stage | Figure |
|---|---|
| Retrieved | 4,869 issues (4,403 open / 466 closed); 43 PRs (separate from issues; the issues endpoint also returned them and they were split out); 2,412 comments of which 1,450 are on the submission thread; 0 API errors; 595 numbers in 1..5,507 unretrievable |
| Normalised records | 6,362 (= 4,869 + 43 + 1,450) |
| Submission-type records ("relevant addition requests") | 6,149 (6,052 with a usable identity, 97 without) |
| Not submissions | 213 (110 no identity, 48 questions/feedback, 43 code contributions, 7 removal requests, 5 link corrections) |
| Duplicate records merged | 1,184 (6,052 − 1,184 = 4,868) |
| Canonical candidates | 4,868 |
| Evaluation | eligible 3,502; needs_review 1,353; ineligible 13 |
| eligible_unblocked (eligible, no security flag, no removal hold; not approval) | 3,467 |
| Approved / published | 0 / 0 (review not started) |

The difference between "about 2,900 requests" and these figures is not established by the data. The origin of that estimate is unknown. The only figure near it anywhere in this repository is an earlier, superseded dry-run count of about 2,950 *eligible projects* produced on partial data (recorded only in the revision note of `submission-eligibility-criteria.md`); it counted projects, not requests, and is not a result. Other reasons a count can differ: upstream grew by hundreds of issues per month through 2026 (925 in the first 16 days of October), and one canonical candidate can carry several records. The importer reports its own counts and does not target the estimate.


## 4. What the source data contains (measured, with limits)

* **Labels:** 0 of 4,869 issues carry any label, so labels cannot be used to separate request types.
* **Edits:** not measured. `updated_at` differs from `created_at` on 1,245 issues, but REST `updated_at` also changes on comments and state changes, so it does not identify body edits. The importer stores a content hash so later runs can detect edits.
* **Record classes versus the brief's categories:** the classifier distinguishes submission, submission_unclear, no_identity, question_or_feedback, code_contribution, removal_request and link_correction. Feature requests, bug reports and discussions are all folded into `question_or_feedback` (48 records) and no-identity records; **spam is not a separate class** (bulk and template families are flagged through `bulk_submitter` and `tools_not_listed` quality indicators instead), and unrelated content is only detected when it lacks any identity or MCP signal (I3, 11 projects). Finer classes would need a labelled sample.
* **Locations of identifiers:** extracted from issue bodies and submission-thread comments; other-issue comments (962) are context only; linked PRs and referenced repositories are used through enrichment (manifest files, README, topics).
