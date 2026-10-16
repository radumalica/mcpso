# Phased Implementation Checklist

Legend: [x] done in this repository (audit branch), [ ] to do. Nothing is published, deployed or loaded into a production database by this checklist without explicit approval.

## Phase A: independent foundation and critical fixes
- [ ] A1 Decide name, domain, legal entity; clear availability and trademark (finalists in `rebranding-proposal.md` are unconfirmed).
- [ ] A2 Create the product repository from the current code (separate application); keep `LICENSE`; add `NOTICE` with attribution and modification notice; mark modified files.
- [ ] A3 New cloud accounts, database project, keys, analytics (cookieless) and deployment config; no shared credentials; secrets only in environment/secret manager.
- [ ] A4 R04 remove inherited branding, GA/AdSense IDs, fake 5-star, policies for another operator; replace `public/` assets; verify the `templates/tailspark` licence.
- [ ] A5 R01 remove/lock public write and LLM-trigger routes; R02 upgrade `next`/`react`, drop `vercel`, one lockfile; R03 fix the type error, green build, CI (typecheck, lint, tests, audit, secret scan); R05 RLS default-deny proven by tests.
- [ ] A6 Moderation, takedown and privacy policies drafted; counsel review of the rights questions in `import-eligibility-policy.md` §6 scheduled.
- Exit: CI green; no anonymous write path; no critical/high production advisories; no upstream identifiers in the tree.

## Phase B: importer and data model
- [x] B1 Collector: paginated, rate-limit aware, backoff, resumable, incremental watermark, token from `GITHUB_TOKEN` (`tools/upstream-import/collect.mjs`).
- [x] B2 Normaliser, dedup (rules R1-R6 with rename merge), enrichment (GraphQL, manifest evidence, subpath scoping), classifier (E/N/I rules, security flags, removal hold), reconciliation script; 34 tests passing.
- [ ] B3 Add `--dry-run`, import batch id and per-record `fetched_at` to every output; write `import_error` entries with retry counts.
- [ ] B4 Tests for the GitHub client (pagination, retries, rate limits, malformed data), interruption/resume, idempotent re-run, incremental updates (strategy §2).
- [ ] B5 Synthetic fixture set (~200 records, no real third-party text) covering edge cases.
- [ ] B6 Migration 0001 reviewed and applied to an empty staging database; migration runner and CI job; RLS test suite.
- [ ] B7 Database loader (raw → `source_record`, candidates, mapping, evaluations) with upsert semantics and `suppression` check.
- [ ] B8 Migration 0002 (transition functions, audit triggers, bulk action/undo).
- [ ] B9 Representative sample run (stratified) into staging; reconcile; hand-check; fix defects.
- Exit: acceptance criteria "Importer" met.

## Phase C: full ingestion and review
- [ ] C1 Decide the dataset cut-off date; fresh full collect (or incremental on top of the 2026-10-16 snapshot).
- [ ] C2 Run the full pipeline; produce the reconciliation report; list unretrievable records.
- [ ] C3 Interim review workflow (before the admin UI exists): exported CSV queues + SQL scripts that call the transition functions; record every decision.
- [ ] C4 Review ambiguous duplicate groups, security-flagged and removal-held candidates first; then `needs_review` by rule (N-rule ordering by volume).
- [ ] C5 Hand-checked strata results recorded; bulk-approve permitted strata chosen under policy §3.1.
- [ ] C6 Write or approve original summaries; rights tier check; publish the first wave (candidates with manifest or SDK evidence), in batches of ≤ 500.
- Exit: acceptance criteria "Data" met; counts reconcile from source to listings.

## Phase D: registry launch
- [ ] D1 Admin/review UI: filters (status, evidence level, maintenance), source records and duplicate groups, side-by-side compare, why-panel with rule IDs, metadata correction, bulk actions with preview and undo.
- [ ] D2 Public site: catalogue with pagination, search and filters, listing detail pages (install block, transports, licence, evidence level and date, source links), mobile navigation, accessibility fixes, correct HTTP status codes.
- [ ] D3 Submission (authenticated, validated, duplicate check), correction and removal workflows, status page.
- [ ] D4 Operations: backups with restore drill, monitoring, structured logs, runbooks, staging environment.
- [ ] D5 Monitor data quality, moderation backlog and performance for the first weeks; adjust rules.
- Exit: acceptance criteria "Registry launch" met; counsel sign-off on rights/privacy.

## Phase E: advanced features
- [ ] Only after D is stable: compatibility matrix, per-client install snippets, API and export, feeds, badges, advisory signals, ownership/domain proof, MCP server for the registry, sandboxed testing (needs its own security review). See `master-plan.md` §7.
