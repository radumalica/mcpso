# Submission Eligibility Criteria

Status: **normative** for the audit-phase classifier (`tools/upstream-import/classify.mjs`); the code implements these rules literally and `test/classify.test.mjs` pins each rule.
Rule IDs (`E1`, `N3`, ...) appear in every classified record's `reasons[]`, so any result can be traced to a rule.

### Revision history (kept honest)

* **Rev 1 (2026-10-16, before any classification ran):** first draft of E1-E4, N1-N9, I1-I3.
* **Rev 2 (2026-10-16, after a *dry run* of the classifier on partial data):** the dry run was inspected for false positives, and the rules below were tightened for **precision, not to hit a target count**. The dry-run counts (e.g. "2,952 eligible") are **superseded and appear nowhere in the results**. Changes:
  1. **E2:** a Python/npm/Go/Rust/JVM *SDK dependency* now also requires *server wording* (an SDK dependency is also present in MCP clients). Previously any SDK signal sufficed. The pyproject scanner now reads dependency sections only (the dry run's regex could match `keywords = ["mcp"]`); `package.json` evidence is the `mcpName` field only (not any `mcp` key); `server.json` must be registry-shaped.
  2. **Monorepo scoping:** evidence for a project claimed at a subpath comes **only** from that subpath (manifests, README wording, existence). Root-level evidence no longer counts for subpath projects and vice versa; I3 never applies to subpath projects. (Rev 1 evaluated one subpath per repository and shared the result with sibling projects, a defect found in review; enrichment was re-run.)
  3. **E1b / registry:** a repository-URL match against the official MCP Registry counts only if the registry name is in the repository owner's own `io.github.<owner>/` namespace; a bare match on the entry's self-declared repository URL is only a *weak* signal. For repositories that do not resolve, only package or remote-endpoint matches count.
  4. **N9:** only a transfer to a **different owner** triggers review; a rename under the same owner is informational (`renamed`).
  5. Removal-request handling: candidates are mapped to projects for manual confirmation, never auto-suppressed.

## 0. Principles

1. **Eligibility is not verification.** "Eligible" means: there is sufficient *static, non-executing* evidence that the project is, or distributes, an MCP server, and the listing has enough information to be useful. It says **nothing** about whether the server builds, runs, speaks the protocol correctly, or is safe. Those are separate verification levels (see `target-architecture.md`).
2. **No execution, no installation, no probing.** Evidence comes only from (a) GitHub API repository facts, (b) the *text* of manifests and README fetched through the GraphQL API and pattern-matched locally, and (c) a snapshot of the official MCP Registry. Remote endpoints advertised by submitters are **never contacted**.
3. **Not evidence.** The following alone never make a project eligible: merged/open/closed state of the upstream issue or PR, the author's claims, star count, the existence of an install command, the presence of a README, or MCP wording in the submission text.
4. **Absence of evidence is not evidence of absence.** A failed lookup (404, private, timeout) routes to *Needs review*, never to *Ineligible*.
5. **Security concern is an independent flag**, orthogonal to the category. A project may be Eligible and flagged. Flagged projects are excluded from the "import-ready" set until reviewed.
6. **Conservative by construction.** When rules conflict or evidence is missing, the result is *Needs review*.

## 1. Record-level gate (what counts as a submission)

Every source record gets an `intent` (heuristics in `lib/extract.mjs::classifyIntent`). Only records with intent `submission` or `submission_unclear` that carry **at least one identity** (GitHub repo URL, non-restricted remote endpoint, or package identifier) are grouped into projects.

| Intent | Meaning | Handling |
|---|---|---|
| `submission` | Identifying link + submission wording | Grouped into a project |
| `submission_unclear` | Identifying link, no submission wording | Grouped into a project |
| `code_contribution` | A pull request | **Not a submission.** Kept as provenance; `Closes #N` links are recorded |
| `removal_request` | Asks to remove/unlist a listing | **Suppression request**: written to `removal-requests.jsonl`; must be honoured before any import |
| `link_correction` | Replacement link for an existing mcp.so listing | Written to `link-corrections.jsonl` for manual application |
| `question_or_feedback`, `no_identity`, `empty` | Not actionable as a listing | Counted, not imported |

Per the project owner's guidance, submissions are made through **issues** (and comments on the submission thread, issue #1); PRs are code changes, not listings.

## 2. Project-level categories

### 2.1 Eligible: all of E1-E4 hold

* **E1 Identity.** The claimed GitHub repository resolves via the GitHub API (public, non-empty, not a template), **or** (rule **E1b**) the project is matched to an entry of the official MCP Registry in a way the registry verifies: by **package id** or **remote endpoint**, or, for a *resolved* repository, by repository URL **where the registry name is in the repository owner's namespace** (`io.github.<owner>/…`). An entry that merely declares the same repository URL under another namespace is only a weak signal (N1). E1b is the only route for projects without a resolvable repository.
* **E2 MCP evidence (at least one of):**
  * a **registry-manifest signal**: a `server.json` conforming to the MCP registry schema (schema URL, or a `namespace/name` with `packages`/`remotes`), a `package.json` `mcpName` field, or a verified match to the official MCP Registry (E1b above). Sufficient on its own.
  * an **SDK/framework dependency** in a root manifest, or in the manifest under the claimed subpath, for `package.json`, `pyproject.toml` (dependency sections only; keywords, project name and scripts do not count), `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, or `build.gradle[.kts]` (signature lists in `enrich.mjs`) **plus server wording** (evaluated in the same scope): an MCP-server topic, or the repository description or README saying it is an "MCP server" / "Model Context Protocol server". An SDK dependency alone proves MCP *involvement*, not that the project is a server (clients and hosts depend on the SDK too), so it is classed as weak (N1).
* **Scope rule for monorepos.** For a project claimed at a subpath, only manifests and README wording *under that subpath* count, and the subpath must exist (else N5); for a repo-level project only root evidence counts. A server-wording match for a subpath project must come from the subpath README.
* **E3 Usefulness.** A name; a description of at least 20 characters (from the submission or the repository); and an access route: a package identifier, an install command, a remote endpoint, or a README of at least 500 bytes.
* **E4 Independence.** The repository is not a fork (forks go to review as probable re-listings of their parent), and no blocking ambiguity flag is present (see N6).

### 2.2 Needs review: relevant but not provable. Any of:

* **N1** Repository resolved, but only *weak* MCP signals exist (topic, README mention, description mention, name contains "mcp", or an SDK dependency without server wording).
* **N2** Repository could not be resolved (`not_found_or_private`, query failure): no judgement is possible.
* **N3** No repository; remote endpoint and/or package only, not matched in the official registry. (An endpoint is not contacted, so a hosted server cannot be evidenced here.)
* **N4** Fork of another repository (`fork_of:<parent>`).
* **N5** Claimed subpath does not exist in the repository.
* **N6** Blocking ambiguity from deduplication: `same_repo_incompatible_names`, `multiple_keys_merged`, `shared_package_across_repos`, `shared_endpoint_across_repos`. (`monorepo_subpath_project` is informational only.)
* **N7** Eligible on evidence, but E3 fails (no description or no access route).
* **N8** Resolved repository, no SDK evidence, but also unable to be judged unrelated (insufficient README, e.g. under 200 bytes).
* **N9** The repository was **transferred to a different owner** (GitHub resolves the submitted `owner/name` to a different owner): reviewed once to confirm the new owner is legitimate. A rename under the *same* owner is not a review trigger; it is recorded as the informational indicator `renamed` and merged by rule R6.

### 2.3 Ineligible: demonstrably not a listable MCP server

* **I1** The repository is part of the upstream registry infrastructure (`chatmcp/*`).
* **I2** Resolved repository is **empty** or a **template** repository, with no other identity claimed.
* **I3** **No MCP signal anywhere** (repo-level projects only; never for subpath projects): repository resolved, public, non-empty, README ≥ 200 bytes, and *none* of: SDK/registry-manifest evidence, MCP topic, MCP mention in README or description, "mcp" in the repository name, and the submission claims neither a remote endpoint nor a package. The submitter's own wording is **not** counted as a signal. Confidence is medium; the classifier output includes a sample for manual precision checking (see `submission-dataset-analysis.md`).
* **I4** Duplicate submissions are *not* project-ineligible: the project is listed once; extra source records are marked `duplicate_of` the project and retain provenance.

### 2.4 Security concern (independent flag)

Raised when any static indicator fires on the submission text. Indicators: prompt-injection phrases addressed at AI readers, pipe-to-shell install commands, requests to send private keys or seed phrases, zero-width/bidirectional control characters, long encoded blobs, advertised endpoints on restricted hosts (IP literals, localhost, `.internal`, `.local`, metadata hosts), URL shorteners, and official-scope impersonation (`@modelcontextprotocol/*` claimed by a non-official repository owner). These are *review triggers*, not findings of malice; many hits are expected to be benign (e.g. documented `curl | sh` installers). The reverse also holds: no flag does **not** mean a project is safe.

## 3. Informational quality indicators (never change the category)

`missing_license` (no SPDX id, or `NOASSERTION`), `archived`, `stale` (last push more than 18 months before collection), `missing_install_info` (no package, install command, or endpoint), `incomplete_metadata` (any of description, license, install route, hosting/transport unknown), `bulk_submitter` (author has ≥ 25 distinct projects), `not_submitted_by_repo_owner`, `upstream_closed_not_planned`, `tools_not_listed`, `listed_in_official_registry`, `renamed`.

## 4. Known limitations

* SDK signatures are a maintained allow-list; servers written against an unlisted framework, in languages whose manifests we do not read (e.g. C# `.csproj`, Ruby gems, Swift packages), or with dependencies in nested workspaces fall into **N1/N8** rather than Eligible. This biases the result toward *under*-counting Eligible.
* Monorepo servers are only evidenced through the manifest at the claimed subpath.
* Branch names containing `/` in `tree/<branch>/...` URLs resolve to a wrong subpath (flagged by N5 if it does not exist).
* Hosted/remote-only servers cannot reach Eligible without an official-registry match until an opt-in, SSRF-safe protocol probe exists.
* Maintainer opt-outs: removal requests are matched only by explicit repository URL in the request.
