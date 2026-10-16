# MVP versus Post-Launch Feature Matrix (Revision 5)

Replaces the P1/P2/P3 labels of the rev 3-4 catalogue (`master-plan.md` §6), several of which were desirable rather than necessary. Classes:

* **LB**: launch-blocking (public launch cannot happen without it; security, legal and integrity gates are always LB).
* **MVP**: in the first public release, but a defect or gap does not block if the gate-level behaviour is safe.
* **Post**: after launch, justified by measured need.
* **Later**: frontier; needs its own design and threat model.

Sizes are one-engineer estimates (S ≤ 1 week, M ≤ 1 month, L > 1 month), unvalidated.

## 1. Launch scope (what the first public release contains)

| Area | Requirement | Class | Size | Notes |
|---|---|---|---|---|
| Security | Phase A fixes: no anonymous catalogue write, server-side authorisation, RLS default-deny proven by tests, no critical/high production advisories, rate limits | **LB** | M | audit R01-R05, R12 |
| Publication boundary | gates P1-P8, transition functions, guards, bulk guardrails, tests | **LB** | M | `db/migrations/0002`, `lib/gates.mjs` |
| Auth | GitHub OAuth for owners and reviewers; reviewer role; session security | **LB** | S-M | |
| Audit and backups | `audit_log`, `review_decision`, backups with a **performed** restore drill, error monitoring | **LB** | S-M | |
| Takedown, correction, removal | request form, ownership check via GitHub permission, hold, decision, suppression list, re-import prevention | **LB** | M | gate LG3 |
| Legal and privacy | terms, privacy notice, takedown contact (Q6), policies; rights questions decided or interim restrictions in force | **LB** | S + external | LG4 |
| Licence compliance | `LICENSE`, `NOTICE`, template licence verified, no upstream branding/tracking | **LB** | S | LG9 |
| Catalogue | pagination; search (database full-text, no external service); essential filters: content type, evidence level, hosting/transport (declared), licence, archived | **LB** | M | replaces fake stars/"featured"; correct HTTP statuses, no soft 404 |
| Listing detail | name from repository/identifier, source links and source issue link, retrieval/check date, evidence level with required wording, declared package/endpoint text, licence, "not reviewed/tested" statement | **LB** | M | no install-snippet generator |
| Submission | authenticated form with validation and URL parsing, duplicate detection against candidates (exact key, package, endpoint, rename), status page for the submitter | **LB** | M | reuses importer extraction and rules |
| Review | queue with filters (status, lane, evidence level, flags), source records and duplicate groups, side-by-side duplicate compare, merge/split, approve/reject with reason, why-panel (rule IDs), metadata correction, bulk approve/reject with preview, count check, bound, undo | **LB** | L | the main engineering effort |
| Importer | the full historical import, resumable, dry-run, batch ids, reconciliation (Phase B-C) | **LB** | M | first-class |
| Quality | CI, automated tests ≥ 80% on new code, accessibility basics (keyboard, labels, contrast, zoom, mobile navigation), correct error handling | **LB** | M | |
| Content types | `content_type` field set by reviewer (server, client, skill, CLI/library, framework, tool) used as a filter | MVP | S | |
| Moderation visibility | public changelog of removals/corrections | MVP | S | internal audit log is LB |
| Freshness | show last-check date and archived/stale flags from stored facts | MVP | S | scheduled re-check job is Post |
| Docs | published eligibility criteria, evidence-level definitions, takedown process, contribution notes | MVP | S | |
| Analytics | none, or cookieless aggregate only; no third-party trackers | MVP | S | |

## 2. Post-launch (re-classified from earlier "P1/P2")

| Feature | Earlier | Now | Reason |
|---|---|---|---|
| Full client compatibility matrix (M2) | P1 | **Post** | needs per-client verification data the registry does not have; wrong claims would break the "honest evidence" principle |
| Extensive generated per-client install snippets and deep links (M3) | P1 | **Post** | MVP shows declared identifiers and links to the project's own instructions; generation needs verified manifests |
| Public read-only API and bulk export (E1) | P2 | **Post** | blocked by Q4; the internal read model is the only API at launch |
| Feeds, badges, watch/webhooks (E3-E5) | P2 | **Post** | growth features |
| MCP server for the registry (E2) | P2 | **Post** | after the API |
| Advisory intelligence (T2, T4) and permission/risk labels (T5) | P2 | **Post** | needs reliable data and care with wording |
| Advanced ownership verification: domain proof, verified-publisher programme (T3 advanced, F5) | P1 | **Post** | MVP uses GitHub permission checks for corrections/removals only |
| Scheduled freshness re-checks and liveness (T1 job) | P1 | **Post (early)** | first release shows dated facts; schedule within the first weeks after launch |
| Official-registry cross-links (S4, D3) | P3 | **Post** | |
| GitHub Action / CLI for submission (S3) | P2 | **Post** | |
| Versions and changelog per server (S6) | P3 | **Post** | |
| Capability facets beyond the essential filters (M4), compare view (M6), collections (M7), similar servers (M8), tool-level search (M5) | P2-P3 | **Post** | |
| Internationalisation (X2), performance budgets in CI (X6), public status page | P2-P3 | **Post** | |
| MCP clients directory (E6) | P3 | **Post** | |

## 3. Later (frontier; unchanged, each needs a separate design and threat model)

Sandboxed build and protocol tests (evidence level 3), remote endpoint prober, tool-description scanning, semantic search, abuse-resistant community signals (replacement for ratings), trust-aware client integration, agent-facing recommendations, signed releases and SBOM display.

## 4. Re-classification rules

1. A feature is **LB** only if its absence would make the launch unsafe, unlawful, dishonest, or unable to process the imported set.
2. A feature is not raised because it is desirable; each **Post** item needs a measured need (usage, reviewer data, or an explicit decision) before scheduling.
3. Security, rights and integrity gates are never downgraded (`publication-gate-checklist.md` §4).
