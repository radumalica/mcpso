# Master Plan: a new, independent MCP registry

> **Superseded by `master-plan-v5.md`** (revision 5). Kept as history; several statements here were corrected there (see `master-plan-v5-changelog.md` and `import-count-reconciliation.md` section 4).

**Revision 4 (current; supersedes revisions 1-3).** The product is an **independently operated registry** built by **enhancing the current Apache-2.0 codebase incrementally**, with its own brand, domain, repository, infrastructure, database, analytics, policies and data model. **Importing, deduplicating, evaluating and selectively publishing the historical MCP server addition requests from the upstream `chatmcp/mcpso` issue tracker is a core, first-class workstream and the initial data-acquisition strategy.** It is not replaced by a manually curated launch. The settled decision history is in `master-plan-changelog.md`.

What "independent" means here: no runtime dependence on the upstream project's API, site or infrastructure; no upstream branding, name, tracking identifiers or implied affiliation; no assumption that the code licence grants rights to third-party submissions, descriptions, logos or screenshots (see `import-eligibility-policy.md` §6). The *code* is kept: Apache-2.0 (`LICENSE`) permits modification and redistribution with notices preserved (§3). The audit's remediation items R01-R05 apply first, and the architecture is reached by incremental migration of this code (`target-architecture.md` §7).

**Companion documents:** `master-plan-changelog.md` (decisions changed), `import-data-flow.md` (diagram and stage contract), `import-schema-and-migrations.md` and `db/migrations/0001_import_pipeline.sql` (draft, unapplied), `import-eligibility-policy.md` (statuses, gates, rights), `import-test-strategy-and-acceptance.md`, `risk-register.md`, `implementation-checklist.md`.

**Evidence status.** §1 restates audited facts about the old app (used as lessons). Everything else is a **proposal**, not an audited fact: not user-tested, not costed against real usage, and not checked against the current MCP specification or client ecosystem, which moves quickly. Verify those before committing. No monetisation is planned (excluded by the original brief); §8 lists sustainability questions so they are decided deliberately.

## 1. What the audit contributes (the defect list to fix in place)

The current codebase is the **starting point**, and the audit is its defect list. Each row is a confirmed failure in the code that must be fixed in this codebase (and then guarded by tests and CI), with evidence in the named report. Strategy: **strangler-style migration**: close the security and build blockers first (Phase A), then replace the data layer, submission and read paths module by module behind the new schema, deleting old code as each piece is superseded. The ~2,700-line size makes this practical; much of the UI shell, routing and Tailwind setup can stay.

| Failure in the current code (audited) | Fix / requirement | Source |
|---|---|---|
| Anonymous POST overwrote and soft-deleted listings; the anon database key was also the write credential; no RLS shipped | every write authenticated and authorised server-side; database access only through a server layer or RLS proven by tests; least-privilege keys | F-01, F-03 |
| Mass assignment and a `startsWith("https://github.com")` URL check accepted `github.com.evil.example` | schema validation with allow-listed fields; parse URLs, compare hostnames exactly | F-02, Q-03/04 |
| Unauthenticated, unbounded paid-LLM and third-party fetch triggers | no public route that spends money or fetches arbitrary URLs; quotas and budgets | F-04, F-06 |
| 143 dependency advisories, deprecated deploy adapter, two lockfiles, `npm ci` failing, no CI | one lockfile, supported framework and adapter, CI gates (typecheck, build, audit, secret scan, tests) from the first commit | D-01..D-05, F-14 |
| Fake 5-star rating, inherited analytics and ad identifiers, policies for a different operator | no invented signals; no third-party trackers by default; policies written for this operator | U-01, F-09, F-12 |
| Errors returned as HTTP 200; DB errors turned into "0 servers"; soft 404s | correct status codes, visible failures, structured logs | Q-05, Q-07, U-07 |
| No pagination, no mobile navigation, search that disables itself, zoom locked, "star" alt text | pagination and filters from day one, accessible and responsive by design (WCAG 2.2 AA) | Q-02, Q-08, U-03, U-09..U-12 |
| Submit = "open a GitHub issue" with free-text extraction | structured, authenticated submission with validation and duplicate check | U-04 |

Observations about the upstream submissions seen while auditing (design inputs for the importer and review tools; the measured counts are in §4): submitters publish fleets of near-identical servers from one account, resubmit the same project repeatedly, rename repositories, and many "MCP" repositories are CLIs, skills, scanners or docs-only repos with an MCP side feature. The new registry needs duplicate and bulk-submission controls, canonical identity, and a content-type taxonomy for that reason.

## 2. Vision, principles, non-goals

* Vision: the place to find an MCP server you can trust enough to try, with an honest account of what is known about it and when.
* Principles: free to submit and use; **evidence over assertion** (levels, dates, no bare scores); accurate before comprehensive; provenance and attribution for every fact; small-team operable; no execution of third-party code outside an isolated, reviewed sandbox; independence from any other directory.
* Non-goals: payments or sponsored placement; hosting third-party servers; anonymous ratings; republishing third-party prose, logos or screenshots without a rights decision; auto-publishing anything (importing never publishes); using the upstream project's infrastructure at runtime.

## 3. Separation and independence rules

1. **Separate application and repository.** Create the product's own repository from the current code (a detached copy, not a tracking fork, if the owner wants no visible link), with its own history of changes. The existing fork `radumalica/mcpso` remains the audit record and is not deployed.
2. **Keep the code, drop everything that identifies or feeds from mcp.so.** Remove or replace: name and logo, favicon and images (`public/`, `preview.png`), copy and legal pages, `ads.txt`, the inherited GA and AdSense identifiers, contact addresses, the sitemap/robots hosts, and any text describing another operator (R04). Review `README`, `pagejson/` and `data/` for upstream-specific content.
3. **Licence compliance (Apache-2.0).** Keep the `LICENSE`, retain copyright and attribution notices in files derived from upstream, add a `NOTICE` crediting the original project as required by the licence, and mark modified files as modified. Apache-2.0 grants **no trademark rights**: the product must not use the mcp.so name or marks. Verify the licence of the bundled `templates/tailspark` template (no licence file was found in the directory during the audit) and of any assets before launch; replace what cannot be cleared.
4. **Upstream data is imported as source records, under the policy in `import-eligibility-policy.md`.** The upstream issues and submission-thread comments are retrieved once (and incrementally while useful) by an offline importer, stored as internal raw source records with provenance, and turned into candidates. Tier 3 content (third-party prose, logos, screenshots) is not republished; listings carry facts, source links and original reviewer-approved summaries. After the import the upstream project is not a runtime dependency. The existing `data/install.sql` is a design reference only; the schema is created by new migrations in a fresh database (`import-schema-and-migrations.md`). Rights and privacy questions that remain open are listed in the policy (§6) and block the first public publication until reviewed.
5. **No shared infrastructure or identifiers**: new cloud accounts, database project, keys, analytics (if any) and email domain. Rotate nothing from the old deployment into the new one.
6. **Own brand and positioning.** New name, domain and entity (cleared for availability and trademark; `rebranding-proposal.md` finalists are candidates only, none confirmed). State plainly the product is independent and not affiliated with the Model Context Protocol project, Anthropic, or any other directory.
7. **Tooling carried over:** the eligibility rules and extraction/classification code from the audit (my own work) may be reused for submission-time checks; their tests must pass without upstream fixtures.

## 4. Data acquisition: the upstream import workstream (first-class)

The registry bootstraps from the historical MCP server addition requests in `chatmcp/mcpso` (renamed `chatmcp/mcp-directory`). The historical estimate of "about 2,900 requests" is **not** the current figure and is not a target; the importer reports what it finds. Measured on 2026-10-16 (full collection, 0 API errors; reproducible from the raw snapshot, a fresh run will differ because upstream keeps growing):

| Item | Count |
|---|---|
| Issues retrieved | 4,869 (4,403 open, 466 closed) |
| Pull requests | 43 (code contributions; kept as provenance only; they overlap the issues endpoint and are separated by type) |
| Comments | 2,412 (1,450 on the submission thread #1 are treated as submissions) |
| Normalised records | 6,362 = 4,869 issues + 43 PRs + 1,450 thread comments |
| Relevant addition requests (submission-type) | 6,149 (6,052 with a usable identity; 97 without) |
| Not submissions | 213 (questions/feedback 48, no identity 110, code contributions 43, removal requests 7, link corrections 5) |
| Canonical candidates after deduplication | 4,868 (1,184 duplicate records merged; 197 renamed repositories mapped, 21 candidates joined by a rename; 228 flagged ambiguous) |
| Machine evaluation | eligible 3,502; needs_review 1,353; ineligible 13; eligible_unblocked 3,467 (not approved) (excludes 26 security-flagged and 9 removal-held eligible) |
| Unretrievable | 595 issue numbers in 1..5,507 (deleted, transferred or inaccessible); 436 repositories not found or private |
| Approved / published | 0 / 0: no review has taken place and nothing is published |

Full reconciliation: `data/upstream-import/reconciliation.md` (produced by `tools/upstream-import/reconcile.mjs`; it fails if the stage counts do not add up). Candidates are not listings: **importing never publishes**. The pipeline stages, automation boundaries, statuses (`candidate`, `needs_review`, `eligible`, `ineligible`, `duplicate`, `published`, `rejected`, `unavailable`), bulk-action limits, publication gates P1-P7 and the content-rights tiers are defined in `import-eligibility-policy.md`; the flow is in `import-data-flow.md`.

**What already exists** (audit branch, executed): resumable paginated collector with rate-limit handling, backoff and incremental watermark; normaliser; deduplicator with rename merge; GraphQL enrichment (no code execution, no install); classifier with rule IDs, security flags and removal holds; reconciliation script; 34 passing tests; CSV review lists. **What remains** for Phase B: dry-run mode, batch identifiers on every record, GitHub-client/interruption/idempotence tests, a synthetic fixture set, the database migrations and loader (`implementation-checklist.md`).

**Rights position.** Public availability of an issue does not make its contents free to republish. Published listings carry tier 1-2 facts, source links and original, reviewer-approved summaries; third-party prose, logos and screenshots stay internal or are excluded. Open legal/privacy questions are flagged, not resolved, in the policy (§6). If part of the data cannot be used (for example author handles or comment text), the fallback keeps the permissible references (canonical repository URL, source issue link and number, date) and drops the rest; the import itself is not abandoned.

**Other (additive) sources**, in the same candidate pipeline and under the same gates: owner submissions through the authenticated form with prefill; maintainers invited to claim unclaimed listings; a `validate`/`submit` CI action; optional read-only cross-reference to the official MCP Registry as a separate "declared" source (decision D3), never presented as reviewed.

**Unclaimed vs claimed** listings: imported listings start unclaimed (banner, facts only) and can be corrected or removed by the verified owner at any time (S5/T3); a removal creates a suppression entry so re-imports cannot resurrect it.

## 5. Workstreams and phases

| Phase | Goal | Contents | Exit criteria |
|---|---|---|---|
| **A Independent foundation and critical fixes** | Safe, unbranded, separate application | decisions D1-D8 (§8); separate repository, accounts, database project, brand; R01 remove/lock public write and LLM routes; R02 upgrade `next`/`react`, drop `vercel`, one lockfile; R03 fix build + CI; R04 remove inherited branding, analytics, fake stars, add NOTICE and attribution; R05 RLS default-deny proven by tests; moderation/takedown/privacy policies drafted; counsel review scheduled | CI green; no anonymous write path; no critical/high production advisories; no upstream identifiers in the tree; licence obligations met |
| **B Importer and data model** | Repeatable, tested pipeline and schema | harden the existing importer (dry-run, batch ids, client/resume/idempotence tests, fixtures); migrations 0001-0002 on an empty staging database; loader; RLS tests; stratified **sample run** end to end | importer acceptance criteria met (`import-test-strategy-and-acceptance.md` §3); sample hand-checked |
| **C Full ingestion and review** | Reviewed candidate set | fresh full/incremental collect to a cut-off date; full pipeline; reconciliation report; review ambiguous, security-flagged and removal-held first, then needs_review; chosen strata bulk-approved under policy limits; original summaries; publish the first wave in batches of at most 500 | data acceptance criteria met; counts reconcile from source records to listings; nothing published with unresolved rights/security/removal flags |
| **D Registry launch** | Usable public registry | admin review UI (filters, source records, duplicate compare, why-panel, bulk with preview/undo, metadata correction, audit history); catalogue with pagination, search, filters; listing pages with source links and evidence level/date; authenticated submission, correction and removal flows; ops (backups, monitoring, runbooks); accessibility; monitor quality and moderation workload | launch acceptance criteria met; counsel sign-off on rights and privacy |
| **E Advanced features** | Differentiation, only after D is stable | §6 P2/P3 items (compatibility matrix, install snippets, API/export, feeds, badges, ownership proof, advisory signals); §7 frontier items after their own security review | each justified by measured use |

Sequencing rules: Phase A before anything is advertised or loaded; no verification claim before the evidence model exists ("verified" is not used at launch); no execution feature before a sandbox design review; removal/correction path ships before anything is public; nothing is auto-published; advanced features are never a prerequisite for importing and reviewing the candidate set. Interim review before the admin UI exists: exported queues plus scripted calls to the transition functions with every decision recorded (checklist C3).

## 6. Feature catalogue

Priority: **P1** needed for a credible launch, **P2** within a quarter of launch, **P3** after usage data. Effort: S (≤1 week), M (≤1 month), L (>1 month), one engineer. These are proposals (see evidence status).

### 6.1 Discovery and comparison

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| M1 | Content-type taxonomy: server, client, skill/plugin, CLI/library with MCP feature, framework, tool/scanner | the audit's spot check found many look-alikes mixed in with real servers; one "server" grid misleads | P1 | M |
| M2 | Client compatibility matrix (Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Zed, others) with the basis and date of each claim | "will it work in my client" is the first user question | P1 | M |
| M3 | Per-client install snippets and deep links generated from manifests (never from submitter prose); copy buttons; stdio vs remote variants | the old detail page had no install block at all | P1 | M |
| M4 | Capability facets (tools/resources/prompts, auth type, data scope, read-only vs write, runtime, licence), with "unknown" shown explicitly | filtering and honest risk labelling | P2 | M |
| M5 | Tool-level search from manifests or opt-in protocol checks | users search for what a server does | P3 | L |
| M6 | Compare view (2-4 servers) | decision support, cheap once facets exist | P2 | S |
| M7 | Curated collections / stacks by reviewers, attributed | long-tail discovery without gameable "featured" | P2 | S |
| M8 | Similar servers from topics and facets (no behavioural tracking) | fewer dead ends | P3 | M |
| M9 | Canonical identity, with forks, renames and duplicates shown ("same project as X", "fork of Y") | duplicate and rename handling was a large share of the audit's work | P1 | S |

### 6.2 Maintenance and trust

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| T1 | Freshness and liveness: last commit/release, archived/renamed/transferred, scheduled re-checks, "stale"/"unmaintained" states with dates | registry data decays | P1 | M |
| T2 | Dependency and advisory signal read from manifests (no install), shown as dated evidence | cheap static evidence | P2 | M |
| T3 | Publisher identity: GitHub ownership proof, domain proof for remote endpoints (`.well-known`/DNS) | underpins claims, corrections, removal, "verified publisher" | P1 | M |
| T4 | Security advisory feed per server and coordinated-disclosure contact; listing banner on known-bad versions | useful in an incident | P2 | M |
| T5 | Permission/risk labels (filesystem, network, shell, secrets), with "declared by publisher" and "observed by inspection" kept apart | visible warnings | P2 | M |
| T6 | Signed releases and SBOM display when publishers provide them | recognises good practice without requiring it | P3 | M |
| T7 | Public moderation log: takedowns, merges, status changes with reasons | trust, defence against bias claims | P2 | S |
| T8 | Anti-spam and bulk-submission controls: per-account quotas, template-family detection, reviewer batching, hidden-Unicode and scope-impersonation checks | the audited ecosystem showed all of these patterns | P1 | M |
| T9 | Eligibility rules engine at submit time (reuse my rule set E1-E4/N/I with rule IDs shown to the reviewer) | consistent, explainable triage | P1 | M |

### 6.3 Submission, ownership, operations

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| S1 | GitHub OAuth (minimal scopes), owner dashboard (my servers, status, reviewer comments), notifications | no identity existed in the old app | P1 | M |
| S2 | Submit-by-URL with prefill from repo manifest; schema validation; duplicate check before submit | removes free-text extraction errors | P1 | M |
| S3 | GitHub Action / CLI to validate and submit | registry becomes part of publishers' CI | P2 | M |
| S4 | Optional read-only cross-links to the official MCP Registry (decision D3) | avoids duplicate effort; never imports reviewed status | P3 | M |
| S5 | Corrections and removal workflow with ownership check and published SLA | must exist before launch | P1 | S |
| S6 | Per-server versions, changelog, deprecation notices | stale install snippets mislead | P3 | M |
| S7 | Backups with a tested restore drill, status page, runbooks, minimal on-call | operations | P1 | M |
| S8 | Admin tooling: bulk actions, merge/split, rule explainer, reviewer workload view | reviewer throughput | P1 | M |

### 6.4 Developer and ecosystem surface

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| E1 | Public read-only API (OpenAPI) and bulk export with licence/attribution fields and stable IDs | ecosystem value; needs versioning and rate limits | P2 | M |
| E2 | MCP server for the registry itself (search, details, install config) | lets agents discover tools; dogfoods the protocol | P2 | M |
| E3 | "Listed on" and evidence badges for READMEs (level and date, never a score) | free distribution loop | P2 | S |
| E4 | RSS/Atom feeds for new, updated and deprecated servers | retention without accounts | P2 | S |
| E5 | Watch/webhook subscriptions | follows E4 and S1 | P3 | M |
| E6 | MCP clients directory | keeps M2 current | P3 | M |

### 6.5 Experience, reach, compliance

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| X1 | WCAG 2.2 AA, keyboard and screen-reader testing, no zoom lock | accessibility failures were extensive in the old app | P1 | M |
| X2 | Internationalisation (UI strings, per-listing language tag); measure the language mix after launch before investing | proposal | P3 | M |
| X3 | Privacy-first analytics (cookieless/self-hosted, aggregate) and a real privacy policy | no inherited trackers | P1 | S |
| X4 | Legal operations: terms, takedown/DMCA path, licence for listing text, attribution rules | republishing third-party text needs a policy | P1 | S |
| X5 | Documentation site: contributor guide, published eligibility criteria, evidence-level definitions, API docs | trust and onboarding | P1 | S |
| X6 | Performance budgets in CI; field metrics after launch | old detail page shipped 481 kB first-load JS | P2 | S |
| X7 | Observability: structured logs without PII, error tracking, queue-age dashboards | failures must be visible | P1 | M |

## 7. Future features (frontier; each needs its own design and threat model)

| # | Feature | Prerequisite | Notes |
|---|---|---|---|
| F1 | Sandboxed build and protocol conformance tests (initialize, list tools, schema validity) as evidence level 3 | reviewed isolation design, separate cloud account, abuse and cost budget | highest-risk item; never in the app's own environment |
| F2 | Remote endpoint prober, opt-in, ownership-proven, SSRF-hardened, rate-limited | T3 | never probe unverified third-party endpoints |
| F3 | Tool-description scanning for prompt-injection / tool-poisoning patterns | tool extraction (M5) | signature-based first; no signature matched in the audited submission text, which says nothing about tool metadata |
| F4 | Semantic search and related-server graph | evidence that keyword search fails | embeddings of public metadata only |
| F5 | Verified-publisher programme and signed attestations | T3, T6 | clear criteria and revocation |
| F6 | Abuse-resistant community signals (verified-user usage reports, "works in client X") | S1, T8 | replaces the old fake stars; no ratings without this |
| F7 | Publish the registry's own feed in an interoperable schema | E1 | positions it as a curation layer |
| F8 | Trust-aware client integration (clients query evidence before install) | E2, F5 | long term |
| F9 | Agent-facing recommendations by capability and evidence level | F3, F6 | needs a safety and liability policy |

## 8. Decisions needed (owner required)

* **D1 Name, domain, brand**: availability and trademark checks outstanding (`rebranding-proposal.md` finalists are unconfirmed).
* **D2 Stack and hosting**: default keep Next.js/React on a current supported release and Supabase/Postgres; replace the deprecated Cloudflare adapter and any layer the audit shows to be unsafe.
* **D3 Official MCP Registry**: used by the importer as a read-only external reference for evidence; whether it is also exposed as a "declared (external)" source or cross-linked is open. It is never presented as reviewed status. Read its terms before any use beyond the audit snapshot.
* **D4 Governance**: who reviews, dispute handling, moderation policy, bulk-submitter policy, reviewer authentication.
* **D5 Rights and privacy (blocking for first publication)**: the five open questions in `import-eligibility-policy.md` §6 (internal retention of third-party text, attribution by GitHub handle and opt-out, reuse of logos/screenshots, export licensing, obligations from upstream terms); counsel review required.
* **D6 LLM use**: default none for public text; any draft summary needs reviewer approval; no unbounded external calls.
* **D7 Evidence thresholds**: whether registry-only evidence (1,930 of 3,502 eligible) may publish as `declared`, or a manifest/SDK signal is required (policy §3.1 proposes the latter for bulk approval).
* **D8 Sustainability and cost**: not estimated here; estimate before Phase D.
* **D9 Dataset cut-off and launch subset**: date of the final collect, size of the first publication wave, and whether needs_review candidates are visible internally only until decided.
* **D10 Raw storage**: raw JSON in the main database or restricted object storage; retention period.

## 9. Risks

Full register with likelihood, impact and mitigations: `risk-register.md` (API limits, upstream drift, data quality, merge mistakes, content rights, personal data, security, application-security debt, moderation workload, takedowns, misleading trust claims, affiliation confusion, importer defects, scope creep, dependency on third-party services, stale listings, cost). The highest-rated: application security debt (Phase A is a hard prerequisite), data quality of imported candidates, content rights, and moderation workload.

## 10. Success metrics (to be measured; none exist yet)

Import: reconciliation identities hold on every run; candidates with a source mapping = 100%; duplicate-merge reversals per 1,000 merges; hand-check false-positive rate per stratum (k of n); review throughput (decisions per reviewer-day) and queue age; share of published listings at evidence level 1 or higher with a last-checked date; takedown turnaround. Product: time-to-first-install from landing; accessibility audit pass rate; re-check coverage in the last 30 days; API adoption. Targets are set after a baseline.

## 11. Immediate next steps

1. Approve the policy and decisions D1-D5 and D9 (brand, stack, official-registry stance, governance, rights/privacy review, cut-off).
2. Phase A: create the separate repository from the current code with `NOTICE`; run R01-R05; verify the `templates/tailspark` licence.
3. Phase B: add dry-run and batch ids to the importer, write the missing client/resume/idempotence tests and a synthetic fixture set; review and apply migration 0001 to an empty staging database; write the loader.
4. Run the stratified sample end to end in staging and hand-check it; then plan the full run (Phase C) against a fresh collect.
5. Prepare the interim review workflow (exported queues plus scripted transitions) so review can start before the admin UI exists.
