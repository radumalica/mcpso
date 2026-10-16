# Master Plan: a new, independent MCP registry

**Revision 2 (scope change).** The product is a **different product and application with no relation to mcp.so**: a new codebase, a new brand, an empty database, and **none of the upstream (`chatmcp/mcpso`) submissions, code, content, branding, analytics IDs or data**. Revision 1 assumed hardening the fork and importing the upstream dataset; both are dropped. What remains of the audit is used only as **evidence-backed lessons and requirements** ("do not repeat this"), plus tooling and rules that are my own work and independent of upstream data (the eligibility criteria and the extraction/classification code, repurposed for submission-time checks).

**Evidence status.** §1 restates audited facts about the old app (used as lessons). Everything else is a **proposal**, not an audited fact: not user-tested, not costed against real usage, and not checked against the current MCP specification or client ecosystem, which moves quickly. Verify those before committing. No monetisation is planned (excluded by the original brief); §8 lists sustainability questions so they are decided deliberately.

## 1. What the audit contributes (lessons, not a base)

The fork is **not** the foundation. It is frozen: no hardening, no import, no deployment. The audit's value is the list of failure modes the new product must avoid, each with evidence in the named report:

| Old-app failure (audited) | Requirement for the new product | Source |
|---|---|---|
| Anonymous POST overwrote and soft-deleted listings; the anon database key was also the write credential; no RLS shipped | every write authenticated and authorised server-side; database access only through a server layer or RLS proven by tests; least-privilege keys | F-01, F-03 |
| Mass assignment and a `startsWith("https://github.com")` URL check accepted `github.com.evil.example` | schema validation with allow-listed fields; parse URLs, compare hostnames exactly | F-02, Q-03/04 |
| Unauthenticated, unbounded paid-LLM and third-party fetch triggers | no public route that spends money or fetches arbitrary URLs; quotas and budgets | F-04, F-06 |
| 143 dependency advisories, deprecated deploy adapter, two lockfiles, `npm ci` failing, no CI | one lockfile, supported framework and adapter, CI gates (typecheck, build, audit, secret scan, tests) from the first commit | D-01..D-05, F-14 |
| Fake 5-star rating, inherited analytics and ad identifiers, policies for a different operator | no invented signals; no third-party trackers by default; policies written for this operator | U-01, F-09, F-12 |
| Errors returned as HTTP 200; DB errors turned into "0 servers"; soft 404s | correct status codes, visible failures, structured logs | Q-05, Q-07, U-07 |
| No pagination, no mobile navigation, search that disables itself, zoom locked, "star" alt text | pagination and filters from day one, accessible and responsive by design (WCAG 2.2 AA) | Q-02, Q-08, U-03, U-09..U-12 |
| Submit = "open a GitHub issue" with free-text extraction | structured, authenticated submission with validation and duplicate check | U-04 |

Observations about the ecosystem seen while auditing (used as design inputs only, **not** as data): submitters publish fleets of near-identical servers from one account, resubmit the same project repeatedly, rename repositories, and many "MCP" repositories are CLIs, skills, scanners or docs-only repos with an MCP side feature. The new registry needs duplicate and bulk-submission controls, canonical identity, and a content-type taxonomy for that reason.

## 2. Vision, principles, non-goals

* Vision: the place to find an MCP server you can trust enough to try, with an honest account of what is known about it and when.
* Principles: free to submit and use; **evidence over assertion** (levels, dates, no bare scores); accurate before comprehensive; provenance and attribution for every fact; small-team operable; no execution of third-party code outside an isolated, reviewed sandbox; independence from any other directory.
* Non-goals: payments or sponsored placement; hosting third-party servers; anonymous ratings; scraping or republishing another directory's content; auto-publishing anything.

## 3. Independence and clean-room rules (new)

1. **New repository**, created empty. Nothing is copied from the fork: no code, templates, copy, images, SQL, policies or config. Code is written fresh; ideas ("what a listing page needs") are fine, text and assets are not.
2. **Own brand.** Name, logo, domain, legal entity and policies are new. The shortlist in `rebranding-proposal.md` was screened only for the earlier rebrand framing and must be re-screened for a wholly new product (availability and trademark checks still not done); drop any name that echoes mcp.so.
3. **No upstream data.** The upstream issues, comments, the `data/upstream-import/` products and the importer's GitHub collector are not inputs to the new product. They stay in the audit repository as research evidence (and the local snapshot) and are never loaded into the new database.
4. **No shared infrastructure or identifiers**: new cloud accounts, database project, keys, analytics (if any), and email domain.
5. **Licence hygiene.** The new codebase gets its own licence chosen deliberately; dependencies are checked for licence compatibility; the audit tooling that is reused (eligibility rules, extraction, classification code) is my own and may move over, but its tests must pass without upstream fixtures.
6. **Positioning.** Say plainly it is independent and not affiliated with the Model Context Protocol project, Anthropic, or any other directory.

## 4. Content strategy without upstream data (the cold-start problem)

An empty registry is useless, and a registry stuffed with unreviewed scraped entries repeats the old product's weakness. Proposed sources, in order of trust:

| Source | How | Consent | Initial label |
|---|---|---|---|
| **Owner submission** (primary) | authenticated form with auto-prefill from the repo/manifest URL; eligibility and duplicate checks at submit time | explicit | `submitted` → review → `listed` |
| **Reviewer-curated seed set** (≈50-200 high-signal servers) | reviewers add servers they have personally assessed from public primary sources (the project's own repo, docs and releases), recording who assessed what and when | owner notified, claimable, removable on request | `listed (unclaimed)` with the evidence actually gathered |
| **Author outreach and a CI action** | `validate`/`submit` GitHub Action and CLI; invite maintainers of seed entries to claim | explicit | `claimed` |
| **Official MCP Registry (optional, decision D3)** | read-only reference to its public API as a *separate* source of declared metadata and cross-links; terms of use read and honoured first | n/a | `declared (external)`, never presented as reviewed |

Explicitly excluded: scraping mcp.so or any other directory; using its submissions, descriptions or ratings; bulk auto-listing from GitHub topic searches without a review step. Public facts about a repository (name, licence, last release) may be fetched per listing within GitHub's terms and rate limits, with attribution and a retrieval date.

**Unclaimed vs claimed** listings are a core concept: unclaimed entries carry a banner, show only verifiable facts, and can be corrected or removed by the verified owner at any time (see S5/T3).

## 5. Workstreams and phases

| Phase | Goal | Contents | Exit criteria |
|---|---|---|---|
| **0 Decide and set up** | Remove the blocking decisions; stand up a clean base | decisions D1-D8 (§8); new repo, licence, brand shortlist cleared (domain/trademark checks); stack and hosting choice; threat model carried over and re-scoped; governance and moderation policy draft | decisions recorded; empty repo with CI (typecheck, lint, tests, audit, secret scan) green on its first commit; security baseline checklist in place |
| **1 Foundation** | Secure core | data model (identity, provenance, evidence, status history, ownership, removal holds, content type) with migrations and RLS tested in CI; GitHub OAuth; server-side authorisation; rate limits; security headers; structured logging; backups | schema recreated from scratch in CI; authz tests prove no anonymous or cross-owner write; no critical/high advisories |
| **2 Core product** | A small but trustworthy registry | owner submission with prefill and duplicate detection; status page; reviewer queue with audit log; catalogue (pagination, filters, content types); listing page with install block, transports, licence, evidence panel; search; correction/removal flow; seed set | an owner can submit and track; a reviewer can decide with a trail; a visitor can find, understand and install a listed server; accessibility pass |
| **3 Trust and ecosystem** | Better than a plain directory | static inspection pipeline (evidence levels 1-2), freshness/liveness checks, ownership/domain proof, advisory signals, public read-only API and export, badges, feeds, SEO foundations, docs site, ops runbooks | owner-verified listings exist; re-check cadence running; API documented |
| **4 Differentiation** | Features that bring users back | §6 items marked P3; compare view; collections; client-compatibility matrix; optional official-registry cross-links | each justified by measured use |
| **5 Frontier** | Only after a security design review | sandboxed conformance runner, endpoint prober, tool-description scanning (§7) | separate threat model and budget approved |

Sequencing rules: no verification claim before the evidence model exists; no execution feature before the sandbox design is reviewed; the removal/correction path ships before anything is public; nothing is auto-published.

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

* **D1 Name, domain, brand**: re-screen candidates for a wholly new product; availability and trademark checks still outstanding.
* **D2 Stack and hosting**: choose a supported framework and a hosting target that is not a deprecated adapter; managed Postgres with RLS tested in CI. (The old stack choices are not binding.)
* **D3 Official MCP Registry**: reference/cross-link only, ignore entirely, or later sync as `declared (external)`. Default recommendation: ignore at launch, revisit after Phase 2, and read its terms before any use.
* **D4 Governance**: who reviews, dispute handling, moderation policy publication, bulk-submitter policy.
* **D5 Data and content licensing**: terms for listing text, what bulk export carries (facts only vs text), attribution.
* **D6 LLM use**: default no LLM-generated public text without reviewer approval; if used, authenticated, budget-capped, sanitised.
* **D7 Evidence thresholds**: whether a registry-style listing alone may publish as `declared`, or a manifest/code signal is required.
* **D8 Sustainability**: the plan assumes a small volunteer or grant-funded team; hosting, runner and storage costs are not estimated here and must be before Phase 4-5.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Cold start: empty registry feels pointless | curated seed set, author outreach, CI action, a few strong collections; avoid inflating counts |
| Reviewer capacity | prefill and rules engine (T9), batching (T8), small scope in Phase 2 |
| Spam, impersonation, fleets of look-alikes | ownership proof, quotas, hidden-Unicode and scope-impersonation checks |
| Legal exposure from third-party text | facts over prose, takedown path, clean-room rules (§3) |
| Accidental dependence on or resemblance to mcp.so | §3 rules, no copied assets or text, independent review of copy and design before launch |
| Malicious servers listed as "verified" | dated evidence levels; never imply safety; sandbox only after review |
| GitHub API limits and outages | caching, incremental refresh, graceful degradation |
| Scope creep from §6-§7 | every P2/P3 item needs measured need |

## 10. Success metrics (to be measured after launch; none exist)

Time-to-first-install from landing; share of listings at evidence level 2 or higher; median submission-to-decision time; correction/removal turnaround; duplicate rate at submission; share of listings re-checked in the last 30 days; accessibility audit pass rate; API adoption; reviewer backlog age. Targets are set after a baseline month.

## 11. Immediate next steps

1. Record decisions D1-D4 and D8 (brand, stack/hosting, official-registry stance, governance, sustainability).
2. Create the new empty repository with CI, licence and security baseline (Phase 0 exit).
3. Define the schema with ownership, content type, evidence levels, status history and removal holds from day one.
4. Prototype the submission flow and reviewer queue against hand-made test fixtures (no upstream data).
5. Run a short research round (5-8 MCP users, 3-5 server authors) to confirm or drop §6 priorities before Phase 2.
6. Decide what to do with the old fork and audit repository: keep as private/archived research, and do not deploy or continue it.
