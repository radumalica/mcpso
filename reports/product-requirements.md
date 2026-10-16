# Product Requirements: Free, Trustworthy MCP Registry

> **Scope update (master plan rev 4):** the product is an independently operated registry built by enhancing this codebase; importing and evaluating the upstream addition requests (R07) is a core workstream, but with its own brand, infrastructure and data model and without upstream branding or runtime dependence. Statements here that treat the product as a rebrand of mcp.so are superseded; see `master-plan.md` and `master-plan-changelog.md`.

Status: proposal derived from the audit. Requirements are tagged **[Launch]** (needed before a public relaunch), **[Next]** (first iteration after validation) or **[Later]**. Priorities link to `prioritized-roadmap.md`.

## 1. Positioning and principles

* **Free to list, always.** A basic listing never requires payment. Future revenue (sponsored placement, monitoring, API, team features) must be additive and visibly labelled; none is built now.
* **Evidence over assertion.** The registry says what was *checked*, when, and how, and never shows a score without data behind it (the current fake 5-star row is removed).
* **Accurate before comprehensive.** The upstream dataset suggests thousands of candidate entries (see `submission-dataset-analysis.md`); only entries meeting the eligibility criteria are published as listings, the rest stay in a review queue.
* **Small team operable.** One deployable web app, one worker, one database; no component without a demonstrated need.
* **Differentiation (what a user gets that a plain directory does not):** canonical identity and de-duplication; separate, dated evidence levels; transparent submission status with reasons; install snippets derived from manifests (not from submitter prose); maintenance and advisory signals from lockfiles; a correction/removal path that works.

## 2. Users and jobs

| User | Job | Success looks like |
|---|---|---|
| **Developer evaluating servers** | "Find a server that does X, check it is maintained and safe enough, and install it in my client" | decision in < 2 minutes from search to copying a working config |
| **MCP server author** | "List my server for free, keep the listing correct, see why something failed" | submission in < 3 minutes; never wonders what happened |
| **Registry reviewer** | "Process the queue fast and consistently" | clear reasons per item, one-click merge/accept/reject, audit trail |
| **Security-minded adopter** | "Know what was and was not verified" | evidence panel with dates; advisories visible |
| **Tooling / agent builder** | "Query the registry programmatically" | stable read-only API/JSON feed [Next] |

## 3. Navigation structure

```
Header:  [Logo/Name]  Browse ▾ (All servers · Categories · Recently updated · Official-registry listed)
                      Submit · Docs · About  ·  [Search box, always visible]
Footer:  Submission guidelines · Verification levels explained · Eligibility criteria ·
         Report a problem · Removal requests · Privacy · Terms · Source code · Changelog
```
Mobile: a hamburger menu exposing the same items (the current mobile header has none).

## 4. Key user journeys

**J1 Find and install.** Search ("postgres", "browser", "calendar") → filtered results (transport, language, hosting, license, category, evidence level) → server page → copy config for the chosen client → (optional) open source repo.
**J2 Submit.** Submit page → paste repository URL (or package id / remote endpoint) → instant checks: URL canonicalised, **duplicate detected** (shows existing listing and offers "claim / suggest correction"), metadata prefilled from the repo → confirm ownership (GitHub sign-in or a verification file) → submission receipt with a status page URL.
**J3 Track a submission.** Status page: lifecycle state, timestamps, checks run with plain-language failure reasons, retry/resubmit, history.
**J4 Correct or remove.** "Report a problem" on every listing: wrong install command, broken link, impersonation, malware suspicion, removal. Owner-verified removals take effect immediately; others go to review.
**J5 Review (internal).** Queue sorted by risk and age; each item shows evidence, duplicates, flags; decisions are recorded.

## 5. Functional requirements

### Discovery
* **[Launch]** Server-rendered, indexable list with real **pagination** (page size 24-48), sort (recently updated, newest listed, name), and total counts.
* **[Launch]** Search over name, description, package id, repository owner/name; empty-state and typo-tolerance basics; query escaping.
* **[Launch]** Filters: category, transport (`stdio`, `streamable-http`, `sse`), hosting (local/remote), language, license, evidence level, "archived hidden by default".
* **[Next]** Capability/integration/use-case search (facets from tool names and categories); related servers.
* **[Later]** Semantic search; saved searches.

### Listing page
* **[Launch]** Name, description, canonical repository link, owner, license (SPDX), language, transport(s), hosting, auth requirement, last repository push, archived/renamed notices.
* **[Launch]** **Copyable install block(s)** produced from package manifests (npm / PyPI / Docker / remote URL) with a per-client tab (Claude Desktop, Cursor, VS Code, generic JSON); clearly marked if derived from submitter text.
* **[Launch]** Evidence panel using the six-level vocabulary from `ui-ux-audit.md` §5, each with date and commit/tag; unperformed levels shown as "not performed".
* **[Launch]** Provenance: "first submitted via issue #N by @user on date" (public data only; link to source).
* **[Next]** Known advisories from lockfile inspection; install-script warnings; tools list as extracted (quoted, labelled).
* **[Next]** Maintenance indicators with documented thresholds (e.g. "no push in 18 months").

### Submission
* **[Launch]** Web form with schema validation, canonical identity resolution and **duplicate detection before submit**.
* **[Launch]** Free; no payment fields anywhere.
* **[Launch]** Ownership proof or third-party flag: listings are labelled "submitted by the repository owner" or "submitted by a third party".
* **[Launch]** Anti-abuse: rate limits per IP/account, size limits, per-account quota with escalation path.
* **[Launch]** Importer for the legacy upstream submissions into the review queue (not auto-published); removal requests honoured as suppressions.
* **[Next]** Status page with history; e-mail/GitHub notification on state change; resubmission/edit flow with diff review for install/endpoint fields.

### Verification & status model
* **[Launch]** Lifecycle: `Submitted → Metadata Validated → Queued → Verifying → Verified / Failed / Needs Review` (definitions, timeouts and stalled-job detection in `target-architecture.md`). Publication is decoupled from verification: an entry meeting the eligibility criteria may be **published as "Repository inspected"** while deeper checks are pending or not offered.
* **[Launch]** Every state has a timestamp, an actor (system/human), and a reason code; no indefinite "pending".
* **[Next]** Opt-in sandbox build and protocol test; remote endpoint probe after ownership proof.

### Corrections and trust
* **[Launch]** "Report a problem" with categories; response SLA published.
* **[Launch]** Public "How we verify" and "Eligibility criteria" pages (derived from `submission-eligibility-criteria.md`).
* **[Later]** Public changelog of listing edits.

### Administration
* **[Launch]** Authenticated reviewer UI (SSO + MFA): queue, merge duplicates (non-destructive), accept/reject with reason, suppress, override flags with justification; audit log.

### Programmatic access
* **[Next]** Read-only JSON API and full-catalogue export with license/attribution; stable IDs (`project_id` derived from the canonical key, as implemented in the importer).

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Accessibility | WCAG 2.2 AA; automated axe checks in CI; zoom allowed; headings and landmarks; decorative images `alt=""` |
| Performance | Listing/detail pages server-rendered, cached at the edge with revalidation; first-load JS < 120 kB on detail pages (current: 481 kB); LCP < 2.5 s at p75 once field data exists |
| SEO | Real 404/410; canonical URLs; sitemap generated from published listings only; OG/Twitter tags; JSON-LD `SoftwareSourceCode` where data is complete; no thin pages (see `performance-seo-growth.md`) |
| Security | As in `threat-model.md` §6; no public write path without authentication; RLS; CSP and security headers |
| Privacy | Minimal analytics, consent where required, policies describing actual processing |
| Reliability | Health checks, structured logs, error tracking, backups with a tested restore, uptime target stated publicly only after measured |
| Operability | One-command local setup, seed/fixture data, migrations in version control, CI gates |
| Licensing | Repository is Apache-2.0 upstream; keep `LICENSE`/notices; record attribution; respect third-party content licenses |

## 7. Metrics (all to be *measured* after launch; none exist today)

Search-to-detail click-through; copy-install-block interactions (event, no content); submission start → completion rate; duplicate-submission rate; time from submission to first decision; verification job completion rate and p50/p95 latency; share of listings by evidence level; search zero-result rate; returning-visitor rate; organic landings on listing pages; correction-request volume and resolution time.

## 8. Out of scope for this phase

Payments, subscriptions, sponsored placement, user reviews/ratings (only added if backed by a real, abuse-resistant system), hosted execution of third-party servers.

## 9. Prioritised redesign plan (summary)

| Priority | Item | Why |
|---|---|---|
| P0 | Remove fake stars, inherited branding/analytics, public write routes; fix build and mobile nav | trust and security blockers |
| P1 | Data model + importer into review queue; list/detail pages with pagination, filters, install blocks; submission form with duplicate detection; reviewer UI | core product value |
| P1 | Static inspection pipeline and evidence panel (levels 1-2) | differentiation without execution risk |
| P2 | Status page and notifications; corrections flow; API/export | retention and ecosystem |
| P3 | Sandbox build/protocol tests, endpoint probe; advanced search | high effort, requires the security controls first |
