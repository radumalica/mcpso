# Import Test Strategy and Acceptance Criteria

## 1. What exists today (executed 2026-10-16)

`node --test tools/upstream-import/test/*.test.mjs`: 34 tests passing, covering URL canonicalisation, enrichment target scoping and manifest scanners, security-flag detection, classification rules and removal hold, and reconciliation identities. **Not yet covered** (gaps to close in Phase B): the GitHub client (pagination via Link headers, retry/backoff, 429/403 rate-limit waits, malformed JSON, token redaction), collector resume after interruption, idempotent re-run, incremental watermark, dry-run mode, import batch identifiers, database loader, RLS, review workflow and the public read model.

## 2. Test layers

| Layer | What | Notes |
|---|---|---|
| Unit | pure functions: URL/identity canonicalisation, extraction, flag detection, dedup rules, eligibility rules, reconciliation | table-driven; include hostile inputs (`github.com.evil.example`, userinfo tricks, unicode lookalikes, `.git`, trailing slash, case) |
| Client | GitHub client against a local fake server | pagination across 3 pages; `Retry-After` and `x-ratelimit-reset` honoured (fake clock); 5xx then success; permanent 404 recorded not retried forever; malformed JSON and truncated body; token never in logs or errors |
| Pipeline | collector → normaliser → dedup → classifier on a **synthetic fixture set** (≈200 records built to include every edge case; no real third-party text committed) | interruption test: kill after page N, resume, final output byte-identical to an uninterrupted run; re-run twice, no new rows; incremental run applies edits and keeps the old revision; dry-run writes nothing |
| Property | idempotence, order-independence of dedup (shuffling input gives the same candidates), monotonic safety (adding a security flag never turns a candidate eligible) | e.g. fast-check style, in plain `node:test` if no dependency is wanted |
| Database | migrations from empty DB; constraints; RLS: anon and authenticated cannot read or write any table except `public_listing`; reviewer role limits; transition functions reject illegal moves; bulk undo restores previous statuses | run in CI against disposable Postgres |
| Security | input validation, safe rendering of untrusted metadata (script/HTML in names, `javascript:` links, bidi/zero-width characters), no secrets in repo, rate limits on submission and any outbound fetch | include the audit's probes as regression tests |
| Review workflow | filters, duplicate compare, why-panel shows rule IDs, bulk preview count equals applied count, undo | component + e2e (Playwright) on the staging build |
| Sample run | process a representative sample (stratified by source year, hosting, identity type, flags) end to end before the full run | reviewer checks the sample by hand |
| Accuracy spot check | hand-check fixed-seed samples per stratum (I3, eligible non-bulk, eligible bulk/template, N1), reported as "k of n", never extrapolated | method in `reports/evidence/classifier-precision-spot-check.md` |

Targets: ≥ 80% line coverage on new importer and application code (project rule), 100% of listed edge cases above present as tests, zero skipped tests in CI.

## 3. Acceptance criteria

### Importer (Phase B exit)
1. Two consecutive runs on the same inputs create **zero** new `source_record` or `candidate` rows and identical outputs.
2. A run killed at a random point resumes and yields output identical to an uninterrupted run (tested on the fixture and on one real full run).
3. `--dry-run` produces the report and writes no rows.
4. Every source record has a batch id, retrieval time, source repo, number, URL and a mapping to exactly one candidate (query: records without mapping = 0).
5. The reconciliation identities hold (script exits 0): retrieved = normalised sources; submission-type = with + without identity; grouped = candidates + duplicates; candidates = eligible + needs_review + ineligible; held and flagged counts ≤ eligible.
6. No outbound request goes to any host other than `api.github.com` (and the read-only official registry host if enabled); concurrency ≤ the configured bound; rate-limit waits observed in logs, not exceeded.
7. No imported code is executed, installed or built (checked by static review of the importer and a test asserting no `child_process`, `eval` or package-manager invocation in importer modules).

### Data (Phase C exit)
1. Full import of all accessible relevant records completes; unretrievable records are listed (not silently dropped); the reconciliation report is generated and attached.
2. All ambiguous duplicate groups and all `needs_review` candidates carrying security flags or removal holds have a recorded reviewer decision or an explicit "deferred" with reason.
3. Hand-checked samples per stratum are recorded with k-of-n results; any stratum with a clear false-positive eligible rate above an agreed threshold (proposed 5%) blocks bulk approval for that stratum.
4. Published listings = exactly the candidates with an `approve` + `publish` decision and passing gates P1-P7; 0 listings with unresolved rights flags, security flags or removal holds.
5. Counts reconcile end to end: source records → candidates → statuses → listings (§4).

### Registry launch (Phase D exit)
Authorisation tests prove no anonymous or cross-role write; CI green with no critical/high advisories in production dependencies; search, filters, pagination, detail pages and review queue work on a phone and by keyboard; takedown and correction paths work end to end including suppression of re-import; WCAG 2.2 AA checks pass on core pages; performance budget set and measured.

## 4. Report required from every importer run

Total source issues retrieved; pull requests retrieved; relevant addition requests identified; raw records ingested; normalised candidates; exact duplicates removed; probable duplicate groups; eligible; ineligible with reasons; awaiting manual review; unavailable or under-documented; import errors and retry counts; candidates approved and published; source records with unresolved rights status. `tools/upstream-import/reconcile.mjs` produces the reconciliation and fails if the identities do not hold; sections not yet measurable (approved/published, rights) print 0 or "unreviewed" rather than a guess.
