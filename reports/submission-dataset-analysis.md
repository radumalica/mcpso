# Submission Dataset Analysis

Scope: the **entire** upstream submission stream of `chatmcp/mcpso` (renamed `chatmcp/mcp-directory`; single source), collected read-only on **2026-10-16 ~09:58 UTC**. This is a full collection of what the GitHub API returned, not a sample (completeness caveats in §1). Every figure comes from `data/upstream-import/` (`collect-manifest.json`, `import-manifest.json`, `normalized/normalize-summary.json`, `dedup/dedup-summary.json`, `classified/classification-summary.json`) and is reproducible with the tools in `tools/upstream-import/` **from the 2026-10-16 raw snapshot**. That snapshot (raw JSONL with SHA-256 sums, normalized/dedup/classified JSONL, enrichment, registry snapshot, logs) is kept outside version control at `~/mcpso-audit-snapshot-2026-10-16/` on the audit host; a fresh collection will differ because the upstream repository keeps growing. Method: `submission-import-methodology.md`; rules: `submission-eligibility-criteria.md`.

Submissions are **GitHub issues** (plus comments on issue #1); pull requests are code contributions only (see §2).

## 1. Collection (what was retrieved)

| Item | Count | Note |
|---|---|---|
| Issues | 4,869 | 4,403 open / 466 closed (state reasons: 275 completed, 191 not_planned; 6 reopened) |
| Pull requests | 43 | 31 open, 11 closed unmerged, 1 merged; code contributions, kept for provenance only |
| Comments | 2,412 | 1,450 on issue #1 (submission thread), 962 on other issues |
| PR file records | 43 | |
| API errors | 0 | |
| Distinct issue authors | 2,801 | 965 distinct commenters on #1 |
| Issue number range | 1 – 5,507 | 4,912 numbers present among issues+PRs; **595 gaps** (deleted, transferred, or inaccessible; listed in `classified/unretrievable-source-records.csv`) |

Completeness limits: the collection is a point-in-time snapshot of a repository that grows daily (≈925 new issues in the first 16 days of Oct 2026); the 595 numeric gaps cannot be recovered through the public API; raw text is stored outside git (`raw/` is ignored). Bot-authored issues: 5.

## 2. Record-level results (denominator: 6,362 normalized records)

| Intent | Records |
|---|---|
| submission | 6,098 |
| submission_unclear | 51 |
| no_identity (no repository, package or endpoint could be extracted) | 110 |
| question_or_feedback | 48 |
| code_contribution (PRs) | 43 |
| removal_request | 7 |
| link_correction | 5 |

6,149 records are submission-type; 6,052 of them carry an identity and were grouped into projects, 97 have none. 213 records are non-submissions (listed in `classified/non-submission-records.csv`). Intent classification is rule-based on text and was spot-read, not measured for precision.

Submissions over time (issues only, by creation month): ≤2025-12 total 72 (a few per month); 2026-01: 19; 2026-02: 203; **2026-03: 764**; 04: 716; 05: 375; 06: 342; 07: 365; 08: 441; 09: 647; **10 (16 days): 925**. Volume rose by two orders of magnitude from early 2026 and is still accelerating.

## 3. Deduplication (denominator: 6,052 grouped submission records)

| Result | Value |
|---|---|
| Candidate projects after dedup | **4,868** |
| Duplicate source records merged into other records | 1,184 (19.6% of 6,052) |
| Projects with more than one source record | 661 (13.6% of 4,868); 618 single-author, 43 multi-author |
| Renamed repositories mapped via GitHub redirect (unit: repositories; 235 records re-keyed; 21 candidates joined by a rename) | 197 |
| Identity type | GitHub repo 3,966; endpoint 808; package 94 |
| Ambiguous projects (manual review) | 228 (4.7%) |
| Claim conflicts across merged records | name 364, repo_url 23, license 14 |

Merge annotation entries (mixed units: R1 and R4 are one per multi-record project, 624 + 37 = 661; R2/R3/R5/R6 are one per record, 16/42/22/235; not a count of merge operations; see `import-count-reconciliation.md`). Ambiguous candidates (distinct projects; 228 in all, 11 with more than one flag): shared package across repos 139, shared endpoint across repos 73, same repo with incompatible names 28; informational monorepo-subpath flag 100.

Largest groups: the repositories with 94, 81, 46 and 17 source records (project identities, listed in `classified/projects-classified.csv`). These are monorepos/fleets submitted once per sub-server and are the main source of ambiguity.

Submitter concentration (authors counted via authorship overlap; co-authored projects can be double-counted): 3,461 authors with ≥1 project; 26 authors with ≥10 projects account for 935 project links; **7 authors with ≥25 projects account for 655 project links (13.5% of 4,868)**; the top three accounts (172, 169 and 105 distinct projects) account for 446. By issue count the top three accounts submitted 389, 208 and 94 issues. Account names are deliberately omitted (personal-data policy, question Q2); they are available in the reviewer-only private files. This is a measured concentration of volume, not a judgement of intent.

## 4. Repository and registry enrichment (denominator: 3,966 GitHub-identity projects)

Enrichment used the authenticated GraphQL API: one evaluation per project key (repo + subpath), manifest/README evidence scoped to the claimed subpath, no cloning, no execution of third-party code, no dependency installation.

| Result | Count |
|---|---|
| Resolved (public, accessible) | 3,530 (89.0%) |
| Unresolved: `not_found_or_private` | 436 (11.0%); no query failures; listed in `classified/unretrievable-repositories.csv` |
| Renamed or transferred | 174 |
| Archived | 48 |
| Stale (flag threshold in methodology) | 17 |
| Missing license (of 3,530 resolved) | 548 |

Official MCP Registry snapshot (read-only, public API, paged): **44,497 unique server entries** (154,131 entries seen across 1,542 pages; versions/duplicates collapse to the unique count; snapshot **complete**, not truncated). 3,460 of the 4,868 candidates (71.1%) match a registry entry by package, endpoint or owner-namespaced repository. A bare repository-URL claim by an unrelated registry name does not count as a match (rev 2 of the criteria).

## 5. Eligibility results (denominator: 4,868 projects)

| Category | Projects | Share |
|---|---|---|
| eligible | 3,502 | 71.9% |
| needs_review | 1,353 | 27.8% |
| ineligible | 13 | 0.3% |

`eligible_unblocked` (eligible, no security concern, not held for removal review; formerly called import-ready; NOT importability and NOT approval): **3,467** (3,502 eligible − 26 security-flagged − 9 held). 19 projects in total (9 eligible) are held because a removal request may refer to them (3 candidate mappings in `removal-candidates.csv`: 1 strong, 2 weak same-author) or their own issue carries removal-like wording (`removal-like-comments.csv`, which is deliberately broad and includes false positives such as a tool named "withdraw"); held projects are reviewed by a human, never suppressed or published automatically.

**Why so few are ineligible.** Ineligible requires positive evidence that a project is out of scope: upstream infrastructure (I1: 1), empty/template repo (I2: 1), or a repository with a README of reasonable size and *no MCP signal at all* (I3: 11). Everything uncertain goes to review instead. This is by design (the criteria never reject on a heuristic) and it means the *ineligible* share is not an estimate of how many submissions are not real servers.

Needs-review reasons (first applicable rule, sums to 1,353): N1 weak signals only 357; N3 endpoint/package only, not in registry 279; N6 blocking ambiguity 196 projects (246 N6 reason entries, one per ambiguity flag); N2 repo unresolved 221; N7 thin metadata 194; N9 owner transfer 73; N8 insufficient README 24; N4 fork 6; N5 subpath missing 3.

Eligible by evidence kind (sums to 3,502): registry only 1,029; manifest+registry 837; manifest only 64; SDK dependency + wording only 302; registry+SDK+wording 88; manifest+SDK+wording 103; manifest+registry+SDK+wording 1,079. **1,930 (55.1% of eligible) rest on cheap evidence only** (a registry match and/or a manifest file, without code-level SDK evidence). Registry listing is self-published, so this is weaker than it looks.

Cross-tab with upstream state shows eligibility is independent of the issue state: 3,282 eligible projects have only open issues; 53 eligible projects have all issues closed; 47 needs_review projects have all issues closed.

Security flags (project level, 36 projects, 26 of them eligible): pipe-to-shell install 22, hidden Unicode 7, restricted/loopback endpoint target 5, possible official-scope impersonation 2. **No prompt-injection pattern matches** were found in the submitted text (0 of 6,362 records matched the signature set; signatures detect only known phrasing). Flagged projects are excluded from `eligible_unblocked` (and cannot be bulk-approved) regardless of category.

Bulk/template submitters (authors with ≥25 projects, 7 authors): 655 projects (354 eligible, 301 needs_review, 0 ineligible). `tools_not_listed` indicator (claim of tools without a list): 236 projects (190 eligible, 46 needs_review).

Metadata completeness (of 4,868): incomplete metadata 2,410 (49.5%); missing install information 609 (12.5%); not submitted by repository owner 1,333 (27.4%).

Hosting claimed (eligible, n=3,502): remote 1,571; local 1,007; both 319; unspecified 605. Transports claimed across all projects (multi-valued): streamable-http 2,307, stdio 1,273, sse 140, remote-unspecified 177. Languages of resolved eligible repos: TypeScript 840, Python 804, JavaScript 521, Go 50, Rust 44.

## 6. Removals and link corrections

7 removal requests and 5 link corrections exist. Only **1** removal request maps to a project with a strong basis; **6 are unmapped** (`classified/removal-candidates.csv`); another 21 comments outside the thread look removal-like (`removal-like-comments.csv`, URLs only; comment text is not republished). Policy: nothing is auto-suppressed, and **entries with an open or unmapped removal request must not be published until a human decides** (roadmap R07).

## 7. Spot-check of the classifier

`reports/evidence/classifier-precision-spot-check.md`: a fixed-seed, single-reviewer sample of 71 projects judged from stored facts. Eligible: 40 of 40 sampled were plausibly MCP servers (17 plain servers, 12 plain bulk-submitter servers; the rest CLIs/libraries with an MCP feature, registry-only listings, or docs/frontend repos). I3: 7 of 11 clearly not servers, 4 uncertain, none clearly wrong. N1 (needs-review): 12 of 20 look like genuine servers, so the review queue contains many acceptable entries. This is **not** a precision estimate; it is a sanity check.

## 8. What the data does and does not support

* Supported: scale (4,868 candidate projects from 6,052 records), growth, concentration, duplication level, repository liveness, registry overlap, and a rule-traceable triage into eligible / review / ineligible.
* **Eligibility is not verification.** No server was run, no endpoint contacted, no package installed, no code security-reviewed. An eligible project is one that shows enough public evidence to be worth *listing candidates for review*; trust labels must come from separate verification.
* Not measured: server quality, tool counts, whether remote endpoints are alive, license correctness beyond the GitHub API field, true precision/recall of the classifier, domain or trademark status of any name.
* Figures are a snapshot of 2026-10-16; the upstream issue stream grows by several hundred per week, so counts will be stale quickly (re-run `collect → normalize → dedup → enrich → classify`; incremental watermarks are implemented).
* Free-text JSONL products (normalized, dedup, classified, eligible-unblocked) are git-ignored in this repository because they embed third-party text; the CSV/summary views are committed. Regenerate them from the raw snapshot as described in `tools/upstream-import/README.md` (raw upstream text was deliberately not committed to this public repository).
