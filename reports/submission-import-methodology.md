# Submission Import Methodology

How the upstream submission dataset was recovered, normalised, de-duplicated, enriched and classified. All code is in `tools/upstream-import/` (README there has the exact commands); all numbers are in `submission-dataset-analysis.md`; the rules are in `submission-eligibility-criteria.md`.

## 1. Source and scope decisions

* **Upstream repository:** `chatmcp/mcpso` (GitHub id 899309258). The README and the site's *Submit* link point to `chatmcp/mcp-directory`; the GitHub API resolves that name to the same repository (`gh api repos/chatmcp/mcp-directory` → `full_name: chatmcp/mcpso`), i.e. a **rename, not a second source**.
* **Submission channel:** per the project owner (message during the audit) *submissions are opened as issues, not pull requests*. Pull requests are therefore collected for completeness and provenance (43 PRs) but are classified `code_contribution` and never create listings. Some PRs reference the issue they implement (`Closes #5392`); that link is recorded.
* **Scope extension: issue comments.** Issue **#1** ("Submit Your MCP Servers here", opened 2024-12-06) holds **1,450 comments**, most of which are submissions (e.g. "**ISMS Directory**… GitHub: https://github.com/…"). The brief names issues and PRs; ignoring #1's comments would have dropped ~1,450 submissions, so comments are collected repo-wide and **only those on issue #1** are normalised as potential submissions (`source_type = issue_comment`). Comments on other issues (962) are retained in `raw/` but treated as discussion.
* **Authentication:** requests were made with the operator's GitHub token (read-only scopes are sufficient) to avoid the 60 requests/hour unauthenticated limit; the token was read from the `gh` CLI at runtime, held in memory, sent only to `api.github.com`, and never written to disk or logs (the logger redacts token-shaped strings).

## 2. Collection (`collect.mjs`)

| Stage | Endpoint | Notes |
|---|---|---|
| issues | `GET /repos/{r}/issues?state=all&per_page=100&sort=created&direction=asc` | the endpoint also returns PRs; items with a `pull_request` key are **dropped** here (43 observed) and taken from the pulls endpoint instead, so nothing is double-counted |
| pulls | `GET /repos/{r}/pulls?state=all…` | provides `merged_at`, head/base refs |
| comments | `GET /repos/{r}/issues/comments?per_page=100…` | repo-wide listing is ~25 requests instead of one request series per issue |
| pull_files | `GET /repos/{r}/pulls/{n}/files` | changed filenames + patch text capped at 60,000 chars; **untrusted text**, never evaluated |

Properties required by the brief:
* **Pagination** via `Link: rel="next"` (not page arithmetic). Sorting is ascending by creation so new records append at the end and offsets do not drift during a run.
* **Rate limits:** the client reads `x-ratelimit-remaining/-reset`, sleeps until reset when ≤ 15 remain, honours `Retry-After` and secondary-limit 403/429 responses, and refuses waits over 75 minutes.
* **Retry:** network errors and 5xx retry up to 7 times with **full-jitter exponential backoff** (`backoffDelay`, unit-tested path), 404/410/451 are returned and recorded rather than thrown.
* **Checkpointing/resume:** per-stage state (`next_url`, page and record counts) is written atomically after every page. **Idempotency:** records are appended and compacted by key `(source_type:id)` (last write wins), so replays never duplicate.
* **Incremental sync:** `--incremental` re-lists records changed since the previous completed run's watermark (run start minus 60 s) via `since`.
* **Logging:** one JSON object per event to `<out>/logs/`; progress is visible per page.
* **Provenance preserved per record:** source repository, type, number, id, URL, author login (and bot/user type, author association), created/updated/closed timestamps, state and `state_reason`, merge status (PRs), labels, comment count, original title and body, collection timestamp, and a `missing_fields` list. Only the login and numeric id of authors are stored (no profile data).

## 3. Normalisation (`normalize.mjs`, `lib/extract.mjs`)

Deterministic pattern extraction, no model involved. Input text is capped at 100,000 characters for matching (raw is kept whole).

1. **Key/value parsing** of `**Label:** value`, `Label: value`, list-item and `### Label` forms; labels are mapped by alias tables (repository/repo/github/source/url/link/…). Order and duplicates are preserved.
2. **Identity candidates:** GitHub repository URLs from labelled fields first, then title, then anywhere in the body; every candidate is canonicalised (§4). Package ids from npm/PyPI URLs, labelled `npm:`/`pypi:` fields and install commands (`npx`, `uvx`, `pip install`, `docker run`, …); known **proxy/CLI packages** (`mcp-remote`, `supergateway`, …) are excluded because they are not the server itself.
3. **Remote endpoints:** URLs in endpoint-like labels, or ending in `/mcp`, `/sse`, or hosted under an `mcp.` hostname; documentation/blog hosts are excluded. Endpoints on restricted hosts (IP literals, `localhost`, `.internal`, `.local`, metadata names) are kept but marked `restricted` and **never contacted**.
4. **Other fields:** name (label → title cleaned of "Submit/Add…" prefixes → heading → repo name), description, license (label or SPDX-like token), transport (`stdio`/`streamable-http`/`sse`, from text), hosting (`local`/`remote`/`both` inferred from endpoint + install evidence), authentication (label or keyword), category, registry name (`io.github.x/y`), tool names (backticked identifiers in a *Tools* section), `mcp.so/server/<slug>` references. Each important field stores *where* it came from (`claims.evidence`).
5. **Missing is explicit:** absent fields are `null`/empty; nothing is inferred from names or descriptions. Conflicting values are retained (`quality_flags`, and variants in the project record).
6. **Intent** (what the author asks for), in priority order: empty → `code_contribution` (PRs) → `removal_request` (remove/delete/unlist wording) → `link_correction` (replacement link for an existing mcp.so listing) → `submission` / `submission_unclear` (has an identifying link) → `question_or_feedback` / `no_identity`. Removal requests are a first-class output (`classified/removal-requests.jsonl`) and must be applied as suppressions before any import.
7. **Security text flags** (`lib/flags.mjs`): prompt-injection phrases, pipe-to-shell installers, requests for private keys/seed phrases, zero-width/bidi characters, long base64 blobs, restricted-host endpoints, URL shorteners, official-scope impersonation. These are review triggers, not verdicts.

**Validation of extraction:** 14 randomly sampled submission records (seed 1, `spotcheck.py`) and ~35 records printed by `sample.py` during exploration were compared by eye against their source text; defects found (proxy packages counted as the server package, documentation URLs counted as endpoints, unlabelled comments with no name) were fixed and the stage re-run. This is a spot check, **not** a measured precision/recall; see §8.

## 4. Canonical identity and de-duplication (`lib/urls.mjs`, `dedup.mjs`)

Canonical key: `github.com/<owner>/<repo>[/<subpath>]`, lower-cased.
* Normalised: `http`/`https`, `www.`, `.git` suffix, trailing slash, query string and fragment, `/issues`, `/pull/N`, `/releases`, `/wiki`, `/blob/…`, `raw.githubusercontent.com`.
* **Monorepo subpaths are part of identity**: `tree/<branch>/<path>` keeps `<path>` (e.g. `modelcontextprotocol/servers/src/git` ≠ `…/src/fetch`; `topoteretes/cognee/cognee-mcp`).
* Rejected as non-repositories: profile-only URLs, `gist.github.com`, reserved paths (`/orgs/…`, `/topics/…`). Look-alike hosts (`github.com.evil.example`, `evilgithub.com`) do not match (unit-tested; contrast with `services/project.ts:23` in the app).
* Unit tests: `tools/upstream-import/test/urls.test.mjs` (9 tests, all passing).

Merge rules (every merge logs its rule; nothing merges on name/description similarity):

| Rule | Condition |
|---|---|
| R1 | identical canonical key |
| R2 | record has no repo and shares a package id with exactly one repo-keyed project |
| R3 | record has no repo and shares a remote endpoint with exactly one repo-keyed project |
| R4 | records with no repo/package share an identical endpoint key |
| R5 | endpoint-only/package-only records share a package id |
| R6 | GitHub resolves a requested repo to a *different* canonical `owner/name` (rename or transfer): merged, reason recorded |

**Flagged, not merged** (these go to the manual-review list): the same package or endpoint claimed by different repositories (forks, re-publishers, or hijack attempts); one repository submitted under unrelated names (monorepo or name collision); subpath-vs-repo overlaps.
Source records of a project are never deleted; `source_record_ids` keeps all, and the first (earliest) is the primary.

## 5. Enrichment (`enrich.mjs`, `registry-snapshot.mjs`)

* **GitHub GraphQL, batched (20 repositories per query, 1 rate-limit point per query):** `nameWithOwner`, archived/fork/template/empty/private flags, push/created dates, stars, description, license (SPDX), primary language, topics, default branch, and the **text** of `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle[.kts]`, `server.json`, `README.md` (plus the same under the claimed monorepo subpath). Owner and repository names are validated against strict regexes before being placed in a query (no injection into GraphQL strings).
* **Static evidence extraction:** manifests are parsed (`JSON.parse` for JSON; regex for TOML/XML/mod files) for dependencies on known MCP SDKs/frameworks. Text is discarded after feature extraction; only booleans, signal names, and a ≤ 120-char README snippet are stored.
* **Official MCP Registry snapshot** (`registry.modelcontextprotocol.io/v0/servers`, paginated, 250 ms between requests): used as an independent reference; a project matching an entry by repository, endpoint, or package id gains evidence signal E1b/E2 and the indicator `listed_in_official_registry`.
* **Not done on purpose:** no probing of remote endpoints; no tarball downloads; no package-registry (npm/PyPI) lookups; no following of shortened links; no cloning.

## 6. Classification (`classify.mjs`)

Applies the rules in `submission-eligibility-criteria.md` verbatim and writes rule IDs into every result (`reasons[]`). Categories: `eligible`, `needs_review`, `ineligible`; **`security_concern` is an independent flag**; `import_ready = eligible ∧ ¬security_concern`. Informational quality indicators (missing license, archived, stale, missing install info, incomplete metadata, bulk submitter, …) never change the category.

## 7. Outputs

See the table in `tools/upstream-import/README.md`. CSV exports: `normalized/normalized.csv`, `classified/projects-classified.csv`, `needs-review.csv`, `ambiguous-for-manual-review.csv`, `security-concerns.csv`, `unretrievable-repositories.csv`, `duplicate-source-records.csv`, `non-submission-records.csv`. Machine-readable: `*.jsonl`, `*-summary.json`, `collect-manifest.json`.

## 8. Limitations and known error sources

* **Extraction accuracy is not measured.** Spot checks only. Free-form submissions with unusual layouts can yield a wrong repository (first URL wins when unlabelled) or a missing field. Conflicts are recorded where detectable.
* **GitHub-centric:** non-GitHub identities (endpoints/packages) are matched only by exact keys; the same hosted service under different URLs will not merge.
* **Branch names containing `/`** produce a wrong subpath (flagged `N5` when the path does not exist).
* **Language coverage of SDK signatures** is an allow-list; unlisted frameworks and unread manifest types lead to *under*-counting Eligible (documented bias).
* **Snapshot semantics:** the data is as of the collection time (see `collect-manifest.json`); the repository receives new issues continuously (the highest issue number grew while this audit ran), so counts will drift. Use `--incremental`.
* **Removal/correction handling** is limited to explicit references; owner verification of removal requests is a product-process step, not automated.
* **Privacy:** only logins and numeric ids of authors are stored; bodies may contain personal data supplied by users (names, e-mails); do not republish raw bodies. The processed dataset should be treated as provenance data, not as content to republish.
* **Terms:** the GitHub REST/GraphQL APIs were used within published rate limits with an authenticated token; the content is user-generated and covered by each contributor's rights; the upstream repository's license is Apache-2.0 (the code), which says nothing about the issue text. Obtain permission or rely on factual extraction with attribution before republishing descriptions.
