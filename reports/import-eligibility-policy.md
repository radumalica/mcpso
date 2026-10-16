# Import and Eligibility Policy

Status: **proposed policy**, to be adopted by the registry's owner. It extends the audit's `submission-eligibility-criteria.md` (rule IDs E1-E4, N1-N9, I1-I3 are unchanged and remain the machine-evaluated part) with the registry's status vocabulary, publication gates, automation boundaries and rights handling. Eligibility is **not** verification and **not** a security review.

## 1. Status vocabulary (candidate level)

| Status | Meaning | Entered by | Leaves by |
|---|---|---|---|
| `candidate` | Canonical candidate exists (normalised + deduplicated) but has not been evaluated | importer | evaluation run |
| `needs_review` | Machine evaluation was uncertain or a hold applies: rules N1-N9, ambiguity flag, security flag, pending removal request | evaluator | reviewer decision |
| `eligible` | Passes E1-E4 with no hold. **Not yet published** | evaluator or reviewer | reviewer approve → `published` |
| `ineligible` | Positive evidence it is out of scope: I1 registry infrastructure, I2 empty/template repo, I3 resolvable repo with no MCP signal | evaluator | reviewer may overturn with a reason |
| `duplicate` | Merged into another candidate (`merged_into`), reversible via merge history | dedup rule or reviewer | undo merge |
| `unavailable` | Source cannot be located or reached: repository 404/private/deleted on two checks at least 7 days apart, or archived with no successor | evaluator (second confirmation) or reviewer | re-check succeeds |
| `rejected` | A human decided not to list it (reason required: out of scope, suspicious, misleading, low quality, owner request) | reviewer | reviewer reopen |
| `published` | Reviewer approved and all publication gates (§4) passed; a `listing` row exists | reviewer | unpublish / takedown |

Mapping from the audit's categories: `eligible`→`eligible`, `needs_review`→`needs_review` (unresolved repository N2 stays here until the second check promotes it to `unavailable`), `ineligible`→`ineligible`. Source records merged by deduplication are `duplicate` at record level and map to their canonical candidate.

## 2. Eligibility criteria (summary; full rules in `submission-eligibility-criteria.md`)

Evidence available without executing anything: GitHub API facts (exists, public, archived, fork, template, empty, licence SPDX, last push, topics, README presence), manifest files read through the API (`server.json`, `package.json` `mcpName`, SDK dependencies, scoped to the claimed subpath), README wording, and matches against the official MCP Registry listing as an **external reference only** (never a reviewed status). The evaluator answers, with rule IDs and evidence stored:

1. Is it an MCP server (E2: registry-manifest signal, or SDK dependency plus server wording, or verified registry match)? Weak signals alone (topic, README mention, name) give `needs_review`.
2. Can the repository/official page be located (E1/N2/N3)?
3. Is there installation or usage information (E3; missing → N7 review)?
4. Licence: recorded as SPDX or `unknown`; **missing licence never blocks listing**, it is displayed.
5. Archived, deleted, stale (quality indicators; archived → shown, not hidden).
6. Fork / wrapper / client / library / tutorial: forks → N4 review; content-type taxonomy (server, client, skill, CLI/library with MCP feature, framework, tool) is set by the reviewer where rules cannot tell.
7. Suspicious or misleading: security flags (pipe-to-shell install commands, hidden Unicode, loopback/restricted endpoints, possible official-scope impersonation); any flag sets `security_concern` and blocks bulk approval.
8. Metadata sufficiency for a useful listing (§4 P5).

Stars, popularity and README length are never used as proof of correctness or safety.

## 3. What is automated and what needs a human

| Stage | Automated | Human approval |
|---|---|---|
| Retrieve raw records | yes (rate-limited, resumable) | no |
| Normalise (extract identity and facts) | yes | no |
| Deduplicate: exact and high-confidence rules | yes, reversible | no |
| Deduplicate: medium/low confidence, `shared_*` ambiguity, name conflicts | proposes only | **yes** (merge or keep apart) |
| Evaluate eligibility | yes | no |
| Bulk reject of `ineligible` by I1/I2 only | proposes | yes, with scope preview |
| Approve for publication | **never automatic** | **yes**, every listing (bulk allowed under §3.1) |
| Write the listing summary | template from facts; optional LLM draft | **yes**, approved text only |
| Takedown, correction, suppression | no | yes |

### 3.1 Bulk actions

A bulk action shows the exact filter, the candidate count and a random sample of 20 before confirmation; the confirmed count must equal the preview count; it is recorded as one `bulk_action` that can be undone as a unit (restores each candidate's previous status from `review_decision`). Proposed limits:

* **Bulk approve** allowed only for: category `eligible`, no security flag, no removal hold or suppression, no ambiguity flag, evidence includes manifest-file **or** SDK dependency (not registry-only), and not part of a bulk-submitter/template family unless a 5% random sample of that family was reviewed with zero rejects.
* **Bulk reject** allowed only for I1/I2 candidates. N-rule candidates are never bulk-rejected.
* No bulk action may touch more than 500 candidates at a time.

## 4. Publication gates (all required for `published`)

* **P1** status `eligible`, or reviewer override with a written reason.
* **P2** no unresolved security flag.
* **P3** no removal hold, takedown, or suppression for the canonical key or any mapped source.
* **P4** canonical identity unambiguous (no open duplicate group).
* **P5** minimum listing data: name, canonical source link, install route or endpoint (or explicit "not documented"), licence (SPDX or "unknown"), content type, last-checked date.
* **P6** original reviewer-approved summary (§6); no copied third-party prose.
* **P7** rights tier check passed (§6); no third-party logo or screenshot unless supplied by the owner with permission.

Evidence level shown on each listing: 0 declared (submitted claim only), 1 repository facts checked, 2 static inspection (manifest/SDK), 3 tested (reserved; requires the sandbox design, not available at launch). The word "verified" is reserved for a documented verification procedure and is **not used at launch**.

## 5. Source-record handling

* Only **issues** are submissions (and comments on the submission thread); **pull requests** are code contributions and are stored as raw provenance only.
* Every source record maps to exactly one candidate (including rejected and merged ones) in `source_candidate_map` with method, confidence and rationale.
* Edited or deleted upstream records: a changed content hash stores the previous version; records that disappear upstream are marked, not deleted. 595 issue numbers in the collected range could not be retrieved (deleted, transferred or inaccessible); they are listed and not guessed.
* Untrusted text (titles, bodies, comments, READMEs) is treated as data: sanitised on render, never executed, never used as instructions to any tool or model.
* Imported code is never executed, installed or built during ingestion or evaluation.

## 6. Content rights and provenance

The public availability of an issue does not make its contents free to republish. Data are handled in three tiers:

| Tier | Examples | Handling |
|---|---|---|
| 1 Identifying metadata | canonical repository URL, owner/name, package identifier, endpoint host, source issue URL/number/date, author handle (for attribution) | stored and shown with source link |
| 2 Short factual metadata | licence SPDX, language, archived/fork flags, last push date, transports, hosting model, tool count if declared in a manifest | stored and shown with retrieval date |
| 3 Third-party prose and media | issue/README descriptions, comments, logos, screenshots, documentation text | raw copy kept **internally only** (restricted table, never served); not republished; listing summary is **original** reviewer-approved text based on tier 1-2 facts |

Rules: preserve attribution and links; do not reproduce comments or long descriptions; do not use upstream branding; record `rights_status` per source record (`unreviewed` by default; all 6,362 normalised records are currently unreviewed). A machine-written summary of third-party prose is still derived content, so LLM drafts need reviewer approval and are off by default.

**Takedown, correction, removal:** a published contact; owner proof by GitHub ownership or a `.well-known`/DNS challenge; a removal creates a `suppression` row keyed by canonical key so re-imports cannot resurrect it; proposed targets: acknowledge in 3 working days, decide in 14; corrections are applied as `correct_metadata` decisions with audit history. Pending removal requests hold the affected candidates (already implemented in the classifier: 19 projects currently held).

**Unresolved rights questions (flagged, no legal conclusions drawn):**
1. Whether and how issue text and README excerpts may be stored internally and what retention period is acceptable.
2. Whether publishing GitHub handles as attribution is acceptable under the applicable privacy law and GitHub's terms; whether to offer opt-out.
3. Whether submitter-supplied logos/screenshots in issues can ever be reused.
4. Licence compatibility of any dataset export that includes tier 2 facts.
5. Obligations (if any) from the upstream repository's own licence and terms regarding data derived from its issue tracker; the Apache-2.0 licence on the code does not by itself address user-generated issue content.
Counsel review is needed before the first public publication.

## 7. Runtime independence

The importer is an offline batch tool. The running application never calls the upstream repository or its infrastructure; ongoing refreshes query GitHub's public API for the **candidate's own repository** with caching, bounded concurrency and rate-limit handling. After import, the upstream source is not a dependency.
