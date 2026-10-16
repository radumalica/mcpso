# Master Plan: a free, independent, trustworthy MCP registry

Consolidates the audit (`executive-summary.md`, `security-audit.md`, `architecture-audit.md`, `code-quality-audit.md`, `dependency-audit.md`, `ui-ux-audit.md`, `threat-model.md`), the product and architecture proposals (`product-requirements.md`, `target-architecture.md`, `prioritized-roadmap.md` R01-R22, `performance-seo-growth.md`, `rebranding-proposal.md`) and the dataset work (`submission-dataset-analysis.md`), and **adds the missing and future features the audit did not analyse** (§4, §5).

**Evidence status.** §1-§3 restate audited facts and existing plans (with the report that holds the evidence). §4-§5 are **proposals**: they are derived from the audited gaps, from patterns visible in the dataset (stated where used), and from general product reasoning. They have not been user-tested, costed against real usage, or checked against the current MCP specification and client ecosystem, which moves quickly; verify those before committing to them. No monetisation is planned (out of scope by the brief); §6 lists sustainability questions only so they are decided deliberately.

## 1. Where we start (audited)

| Area | State | Source |
|---|---|---|
| Code | ~2,700 TS lines, Next 15.0.4/React 19, Supabase anon key for all access, no auth, no tests, no CI, clean build blocked by one type error | architecture-audit, code-quality-audit |
| Security | public create/overwrite/soft-delete, mass assignment, unbounded paid-LLM triggers, 143 dependency advisories, RLS unverified | security-audit, dependency-audit |
| Product | card grid, fake 5-star, no mobile nav, no pagination, no install snippet, submit = open a GitHub issue | ui-ux-audit |
| Data | 4,868 candidate projects from 6,052 submission records; 3,502 eligible, 1,353 needs review, 13 ineligible; 3,467 import-ready; growth 441 → 647 → 925 (16 days) issues/month Aug-Oct 2026 | submission-dataset-analysis |
| Ecosystem | official MCP Registry snapshot: 44,497 unique entries | submission-dataset-analysis |

Strategic conclusion: **stop hardening the prototype; build a small, boring, well-governed registry app behind a new data model, and use the upstream data as a review queue, not as a catalogue.** The official registry already stores metadata at scale (44,497 entries), so the product value is curation, deduplication, dated evidence, and discovery quality, not another list.

## 2. Vision, principles, non-goals

* Vision: the place to find an MCP server you can trust enough to try, with an honest account of what is known about it and when.
* Principles: free to submit and use; evidence over assertion (levels, dates, no bare scores); accurate before comprehensive; provenance and attribution preserved; small-team operable; no execution of third-party code outside an isolated, reviewed sandbox.
* Non-goals this plan: payments or sponsored placement, hosting third-party servers, anonymous ratings, auto-publishing anything.

## 3. Workstreams and phases (consolidates R01-R22)

| Phase | Goal | Contents | Exit criteria |
|---|---|---|---|
| **0 Stop the bleeding** (days) | Make the app safe to leave online | R01 remove public write/LLM routes; R02 upgrade `next`/`react`, drop `vercel`, one lockfile; R03 fix build + CI; R04 remove fake stars, inherited GA/AdSense, branding; R05 verify/enforce RLS (needs live access) | CI green; no public write path; `pnpm audit --prod` has no critical/high; RLS proven by test |
| **1 Foundation** (weeks) | New data model and pipeline | R06 schema + migrations + RLS; R07 import dataset into review queue (removal-held projects excluded); R12 platform hardening (headers, rate limits, validation); R14 tests; R15 rebrand execution (name subject to clearance) | schema migrated from scratch in CI; importer loads 4,868 projects as `candidate`; test coverage target met on new code |
| **2 Core product** | Useful, trustworthy read + submit experience | R09 rebuilt read experience (pagination, filters, install block, evidence panel); R13 search; R08 authenticated submission, duplicate detection, status page; R10 reviewer UI with audit log; R11 static inspection pipeline (evidence levels 1-2) | a user can find, understand and install a listed server; an owner can submit and track; a reviewer can clear the queue with an audit trail |
| **3 Trust and ecosystem** | Make listings verifiably better than a plain directory | R16 SEO; R17 operations; R18 importer hardening + incremental sync; R19 API/export/badges; R20-lite corrections/removal flow; §4 features marked P2 | owner-verified listings exist; public API and export documented; corrections SLA defined |
| **4 Differentiation** | Features that make users return | §4 features marked P3; R21 endpoint prober; R22 advanced discovery | measured retention/usage justify each item |
| **5 Frontier** | Only after security design review | R20 sandbox runner for opt-in build/protocol tests; §5 items | separate threat model and budget approved |

Sequencing rules (from the roadmap): Phase 0 before anything is advertised; no verification claim before the evidence model exists; no execution feature before the sandbox design is reviewed; the removal/correction path ships before the dataset goes public.

## 4. Missing features not analysed in the audit

Priority: **P1** needed for a credible launch, **P2** within a quarter of launch, **P3** after usage data. Effort: S (≤1 week), M (≤1 month), L (>1 month), one engineer.

### 4.1 Discovery and comparison

| # | Feature | Why (evidence / reasoning) | Pri | Effort |
|---|---|---|---|---|
| M1 | **Content-type taxonomy**: server, client, skill/plugin, CLI/library with MCP feature, framework, tool/scanner | the spot check found many eligible or review items that are CLIs/libraries with an MCP side feature, skills, scanners *about* MCP, and docs-only repos (`classifier-precision-spot-check.md`); mixing them in one "server" grid misleads | P1 | M |
| M2 | **Client compatibility matrix** (Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Zed, ChatGPT, others) with the date and basis of each claim | users ask "does it work in my client"; transports claimed in the data are streamable-http 2,307, stdio 1,273, sse 140 across projects (multi-valued), so transport/client fit is a real filter | P1 | M |
| M3 | **Per-client install snippets and one-click deep links**, generated from manifests, never from submitter prose; copy buttons; stdio vs remote variants | detail page currently has no install block at all (U-06); 1,571 eligible projects claim remote hosting, 1,007 local | P1 | M |
| M4 | **Capability facets** (tools/resources/prompts, auth type, data access scope, read-only vs write, runtime, licence) | needed for filtering and for honest risk labelling; 49.5% of candidates have incomplete metadata, so facets must show "unknown" explicitly | P2 | M |
| M5 | **Tool-level search** (search by tool name/description once extracted from manifests or an opt-in protocol check) | users search for what a server *does*; needs extraction pipeline first | P3 | L |
| M6 | **Compare view** (2-4 servers side by side: evidence level, maintenance, licence, transports, auth) | decision support; cheap once facets exist | P2 | S |
| M7 | **Curated collections / stacks** ("for data analysis", "for browser automation") authored by reviewers, transparently attributed | solves the long-tail discovery problem without gaming; replaces fake "featured" | P2 | S |
| M8 | **Alternatives / "similar servers"** from repo topics + facets, not behavioural data | reduces dead ends; avoids needing analytics | P3 | M |
| M9 | **Duplicates and forks surfaced to users** ("same project as X", "fork of Y", renamed from Z) | 1,184 duplicate records, 197 renames merged, 6 forks in review; canonical identity is a differentiator | P1 | S |

### 4.2 Maintenance and trust signals

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| T1 | **Freshness and liveness**: last commit/release, archived/renamed/transferred flags, scheduled re-checks, "stale" and "unmaintained" states with dates | 48 archived, 174 renamed/transferred, 436 repos unresolved at snapshot time; registry data decays | P1 | M |
| T2 | **Dependency and advisory signal** read from lockfiles/manifests (no install), shown as dated evidence | cheap static evidence consistent with the no-execution rule | P2 | M |
| T3 | **Provenance and publisher identity**: GitHub-ownership proof, domain proof (`.well-known`/DNS) for remote endpoints, link to the official registry namespace | ownership proof underpins corrections, removal and "verified publisher"; 27.4% of candidates were not submitted by the repo owner | P1 | M |
| T4 | **Security advisory feed per server** (coordinated disclosure contact, linked CVE/GHSA, listing banner when a known-bad version is reported) | the registry becomes useful in an incident, not only at discovery | P2 | M |
| T5 | **Permission/risk labelling** derived from declared capabilities (filesystem, network, shell, secrets) with "declared by publisher" vs "observed by inspection" kept apart | 22 projects with pipe-to-shell installs and 5 with loopback/restricted endpoints show the need for visible warnings | P2 | M |
| T6 | **Signed releases and SBOM display** when publishers provide them (sigstore, npm provenance) | recognises good practice without requiring it | P3 | M |
| T7 | **Moderation transparency log**: public record of takedowns, merges and status changes with reasons | trust and defence against accusations of bias | P2 | S |
| T8 | **Anti-spam and bulk-submitter controls**: per-author quotas, template-family detection, reviewer batching | 7 authors account for 655 of 4,868 projects (13.5%); template families like fleets of near-identical repos need batch review, not 655 separate decisions | P1 | M |

### 4.3 Submission, ownership and operations

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| S1 | **Accounts via GitHub OAuth** (minimal scopes), owner dashboard (my servers, status, reviewer comments), notifications | no identity exists today (F-01, F-03); required for ownership and corrections | P1 | M |
| S2 | **Submit-by-URL with auto-prefill** from repo manifest/registry entry; schema validation; duplicate check before submit | removes the free-text extraction errors seen in the importer; 97 records had no extractable identity | P1 | M |
| S3 | **GitHub Action / CLI to validate and submit** (`registry validate`, `registry submit`) | makes the registry part of publishers' CI; reduces issue-spam submissions | P2 | M |
| S4 | **Official-registry sync** (read-only mirror of the 44,497 entries as a source, linking both ways) | reduces duplicate effort; lets entries enter as `declared` automatically | P2 | M |
| S5 | **Corrections and removal workflow with ownership check and SLA** | 7 removal requests, 6 unmapped; must exist before public launch (R20-lite) | P1 | S |
| S6 | **Versioning and changelog per server** (release history, breaking-change notes, deprecation notices) | users need to know what changed; avoids stale install snippets | P3 | M |
| S7 | **Backups, restore drill, status page, runbooks, on-call minimum** | R17; absent in the app today | P1 | M |
| S8 | **Admin tooling**: bulk actions, merge/split projects, rule-explainer showing which eligibility rule fired (rule IDs are already stored) | reviewer throughput at 925 submissions per 16 days | P1 | M |

### 4.4 Developer and ecosystem surface

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| E1 | **Public read-only API (OpenAPI) and bulk export** with licence/attribution fields; stable IDs | R19 mentions it; needs versioning policy and rate limits | P2 | M |
| E2 | **MCP server for the registry itself** (search, details, install config) | lets agents discover tools; upstream issue #11 requested it; dogfoods the protocol | P2 | M |
| E3 | **"Listed on" badges and evidence badges** for READMEs | free distribution loop; must show level and date, never a score | P2 | S |
| E4 | **Feeds**: RSS/Atom for new, updated and deprecated servers; webhook for owners | retention without accounts | P2 | S |
| E5 | **Webhook/notification subscriptions** (watch a server or category) | follows from E4 and S1 | P3 | M |
| E6 | **MCP clients directory** (the other half of compatibility) | M2 needs it to stay current | P3 | M |

### 4.5 Experience, reach and compliance

| # | Feature | Why | Pri | Effort |
|---|---|---|---|---|
| X1 | **Accessibility to WCAG 2.2 AA**, keyboard and screen-reader testing, no zoom lock | current: 201 of 205 home images `alt="star"`, zoom disabled, contrast failures (U-09..U-12) | P1 | M |
| X2 | **Internationalisation**: UI strings and per-listing language tag; Chinese content is visibly present in submissions (e.g. listings titled in Chinese), but the share has not been measured | proposal; measure the language mix before investing | P3 | M |
| X3 | **Privacy-first analytics** (self-hosted or cookieless, aggregate only) and a real privacy policy | inherited GA/AdSense IDs removed in R04; policy describes services that do not exist (F-12) | P1 | S |
| X4 | **Legal operations**: terms, DMCA/takedown path, content licence for listing text, attribution rules for imported data | threat-model T20; republishing descriptions needs a defined policy | P1 | S |
| X5 | **Documentation site**: contributor guide, eligibility criteria published, verification-level definitions, API docs | trust and onboarding; criteria already exist as a report | P1 | S |
| X6 | **Performance budgets** in CI (first-load JS, LCP/INP targets measured in the field after launch) | current detail page 481 kB first-load JS | P2 | S |
| X7 | **Observability**: structured logs without PII, error tracking, queue-age and importer dashboards | Q-07: DB errors currently become silent empty results | P1 | M |

## 5. Future features (frontier; each needs its own design and threat model)

| # | Feature | Prerequisite | Notes |
|---|---|---|---|
| F1 | **Sandboxed build and protocol conformance tests** (initialize, list tools, schema validity) run in an isolated, network-restricted runner; results as evidence level 3 | reviewed isolation design; separate cloud account; abuse and cost budget (R20) | highest risk item; never run in the app's own environment |
| F2 | **Remote endpoint prober** with ownership proof, SSRF-hardened, rate-limited, opt-in by owner | T3 domain proof; R21 | do not probe unverified third-party endpoints |
| F3 | **Behavioural tool-description scanning** (prompt-injection / tool-poisoning patterns in tool metadata) | tool extraction (M5), static inspection pipeline (R11) | signature-based only at first; no prompt-injection signature matched in the 6,362 submission records, which says nothing about tool metadata |
| F4 | **Semantic search and related-server graph** | usage data showing keyword search fails (R22) | embeddings of public metadata only |
| F5 | **Verified-publisher programme and signed attestations** | T3, T6 | clear criteria, revocation process |
| F6 | **Transparent, abuse-resistant community signals** (verified-user usage reports, "works in client X" confirmations) | S1 accounts, anti-abuse (T8) | replaces the fake stars; do not ship ratings without this |
| F7 | **Federation / interoperability** with the official registry and other directories (publish own feed in the official schema) | S4, E1 | positions the project as a curation layer |
| F8 | **Trust-aware client integration** (clients query registry evidence before installing) | E2, F5 | long term |
| F9 | **Agent-facing recommendations** (agents choose servers by declared capabilities and evidence level) | F3, F6 | requires clear liability and safety policy |

## 6. Decisions and open questions (need an owner)

1. **Name and domain**: choose from the finalists after trademark and availability checks (none confirmed; `rebranding-proposal.md`).
2. **Hosting**: stay on a Cloudflare-style edge target or move to a standard Node host/managed Postgres; deprecated adapter forces a decision in Phase 0-1 (`target-architecture.md` §6).
3. **Governance**: who reviews, how disputes are resolved, publication of moderation policy, handling of bulk-submitter families.
4. **Data licensing**: terms for imported descriptions and READMEs; whether bulk export carries third-party text or facts only.
5. **Sustainability**: the brief excludes monetisation; the plan assumes a small volunteer or grant-funded team. Operating cost (hosting, LLM calls if kept, runner) must be estimated before Phase 4-5; not estimated in this audit.
6. **LLM use**: keep (with sanitised, reviewed output, cost caps) or drop; currently unauthenticated and unbounded (F-04). Default recommendation: no LLM-generated public text without reviewer approval.
7. **Eligibility thresholds**: whether registry-only evidence (1,930 of 3,502 eligible) may publish as `declared`, or must wait for a manifest/code signal.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Prototype hardening absorbs time better spent on the new model | Phase 0 is strictly limited to R01-R05; new work happens behind the new schema |
| Import creates a low-quality catalogue | publish only eligible + not held; `declared` label; review queue for the rest |
| Reviewer capacity (growth to hundreds of submissions per month) | S8 tooling, T8 batching, auto-prefill (S2), submissions via CI (S3) |
| Spam and impersonation (official-scope names, bulk fleets) | ownership proof (T3), quotas, hidden-Unicode and scope-impersonation flags already detected |
| Legal exposure from republishing third-party text | X4 policy, facts over prose, takedown path before launch |
| Supply-chain / malicious servers listed as "verified" | evidence levels with dates; never imply safety; sandbox only after review |
| Dependence on GitHub API and the official registry | caching, incremental sync, graceful degradation |
| Scope creep from §4-§5 | each item needs a measured need; P3 and §5 gated by usage data |

## 8. Success metrics (to be measured after launch; none exist today)

Time-to-first-install from landing; share of listings with at least evidence level 2; median submission-to-decision time; correction/removal turnaround; duplicate rate at submission; share of listings re-checked in the last 30 days; accessibility audit pass rate; API adoption; reviewer backlog age. Targets are set after a baseline month.

## 9. Immediate next steps

1. Approve Phase 0 and run R01-R05 (needs live Supabase access for R05).
2. Decide §6 items 1-3 (name, hosting, governance) so Phase 1 can start.
3. Start the schema (R06) with `content_type` (M1), ownership (S1/T3) and removal-hold (S5) fields from day one, since retrofitting them is costly.
4. Prototype the reviewer queue (S8, R10) against the classified CSVs to size the review workload before building public pages.
5. Run a short user-research round (5-8 MCP users and 3-5 server authors) to confirm or drop §4 priorities before Phase 2.
