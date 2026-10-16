# Implementation Log (branch `impl/v5-phase-a`)

Tracks coding done against `master-plan-v5.md` / `implementation-checklist.md`. One commit per finished item. Each entry: what changed, how it was verified (command and result), and what remains. Nothing here deploys, publishes or touches a production database. Statements of "passes" refer to commands actually run in this worktree.

| # | Checklist item | Status | Commit |
|---|---|---|---|
| 0 | Branch and log | done | see `git log` |
| 1 | A5 (part): fix the build-breaking type error and the self-disabling search (audit Q-01, Q-02, U-02) | done | see `git log` |
| 2 | A4 / R01: remove public write and LLM-trigger endpoints; regression guard; `test`/`typecheck` scripts (F-01, F-02, F-04, F-10) | done | see `git log` |
| 3 | A3 (part): remove inherited analytics/ads, fake star rating, upstream star widget, zoom lock, upstream-host sitemaps and ads.txt | done | see `git log` |
| 4 | A6 (part): search-term filter-injection fix and baseline security headers | done | see `git log` |
| 5 | B5 (part): GitHub client tests with a scripted fake fetch; malformed-JSON defect fixed | done | see `git log` |
| 6 | B5 (rest): collector resume, idempotence, incremental and provenance tests (fake in-memory API) | done | see `git log` |
| 7 | B4 (part): import batch id on every collected record; collector --dry-run | done | see `git log` |
| 8 | B7 (part): run migrations and SQL tests on PGlite; role/RLS behaviour suite; two SQL defects fixed | done | see `git log` |

## Item 1: search component and clean build
* **Changed:** `templates/tailspark/landing/components/search/index.tsx` rewritten as a real search form (`role="search"`, native submit so Enter and IME composition work, labelled input, submit button with accessible name, `maxLength` 200, never disabled, pending state via `useTransition`). Removed the invalid global `KeyboardEvent<...>` usage and the `inputDisabled` state that disabled the box after the first search.
* **Verified (run in this worktree):** `node_modules/.bin/tsc --noEmit` reports no errors (baseline before the change: 1 error, TS2315 at this file); `node_modules/.bin/next build` completes and lists all routes (first-load JS unchanged: `/` 175 kB, `/[slug]/[name]` 481 kB).
* **Not verified:** interactive behaviour in a browser (no test harness exists yet; component tests come with the test setup in a later item).
* **Observed, not mine:** `reports/master-plan.md` and `reports/master-plan-changelog.md` are deleted in the working tree (unstaged) and were not touched by this work; they are left as found.

## Item 2: public write and LLM-trigger routes removed (R01)
* **Changed:** deleted `app/api/submit-project`, `submit-projects`, `summarize-project`, `summarize-projects` and `debug/apitest.http` (no authentication; they overwrote and soft-deleted listings, spoofed fields, and triggered paid LLM and third-party fetches). Added `tests/security/api-routes.test.mjs`: fails if any `app/**/route.*` exports POST/PUT/PATCH/DELETE without importing and calling `requireUser`/`requireReviewer` from `@/utils/auth` (not implemented yet, so no mutating route may exist), and if the four removed endpoints reappear. Added `npm test` (security guard + importer tests) and `npm run typecheck` to `package.json`.
* **Verified (run here):** `npm test` 58 tests pass (55 importer + 3 guard); after `rm -rf .next` a clean `next build` compiles with no `/api/*` routes; `tsc --noEmit` is clean.
* **Left in place, replaced with the data layer rather than patched:** `services/project.ts` (`saveProject`, `sumProject`, LLM/Jina calls) and the write functions in `models/project.ts` are now unreachable.
* **Consequence:** submissions are no longer possible through the app; the import and review workflow replace that path (Phases B-D).

## Item 3: inherited trackers, ads and upstream artefacts removed (A3, part)
* **Changed:** `providers/theme.tsx` no longer injects Google Tag Manager/AdSense scripts; `app/layout.tsx` loses the AdSense meta and the viewport zoom lock (`maximum-scale=1, user-scalable=no`, WCAG 1.4.4); deleted `public/ads.txt` and the four static sitemaps that listed the upstream host; deleted the hard-coded 5-star `Stars` component and its two usages (it implied ratings that do not exist); deleted the hero GitHub widget that polled the GitHub API every 6 s for the upstream repository (`hero/github.tsx`, `hero/buttons.tsx`).
* **Added:** `tests/security/no-third-party-trackers.test.mjs` (4 tests: no analytics/ad identifiers, no zoom lock, no `ads.txt`/public file naming the upstream host, no star rating or upstream-repository polling).
* **Verified (run here):** `npm test` 62 pass, 0 fail; `tsc --noEmit` clean; clean `next build` succeeds (`/` first-load JS 173 kB, was 175 kB).
* **Not done, needs owner decisions:** product name and domain (D1) so policy pages (`app/(policy)/*` still name the upstream site and contact address and describe analytics/ads that no longer exist), a generated sitemap/robots with the real host, NOTICE/modification notices (A1), and the separate repository/accounts (D2). No brand was invented.

## Item 4: search filter injection fixed, baseline security headers (A6, part)
* **Changed:** `utils/search-term.ts` (`sanitizeSearchTerm`: NFKC, control characters and PostgREST/LIKE syntax characters removed, whitespace collapsed, 200-character cap). `models/project.ts#getProjectsWithKeyword` now sanitises the `?q=` value before building the `or(...ilike...)` filter and returns no rows for an empty term (previously the raw value was interpolated, allowing extra filter clauses). `next.config.mjs`: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` on all paths, `poweredByHeader: false`.
* **Tests added:** `tests/security/search-term.test.mjs` (5), `tests/security/headers.test.mjs` (2).
* **Verified (run here):** `npm test` 69 pass, 0 fail; `tsc --noEmit` clean; clean `next build` compiles; `next start` on a local port returns the five headers for `/privacy-policy` (curl).
* **Not done:** Content-Security-Policy (needs nonces; deferred until hosting target D2), rate limiting and request-size limits (depend on the hosting layer, D2; no write endpoints exist now), the search is still an unindexed `ilike` scan (replaced by full-text search in migration 0003).

## Item 5: GitHub client tests (B5, part)
* **Added:** `tools/upstream-import/test/github-client.test.mjs` (16 tests) using the client's injectable `fetchImpl`/`sleep`/`now` with scripted `Response` objects (no network, no token): Link-header pagination, 404/410/451 returned, list-endpoint 404 is an error, `Retry-After` honoured, exhausted-quota 403 waits for the reset, low-remaining pause, over-long reset aborts, 5xx retry then success, give-up after `maxRetries + 1`, network-error retry, other 4xx not retried, only `https://api.github.com` requested (http, foreign and look-alike hosts refused), token only in the `Authorization` header and absent from logs, errors and URLs, no header without a token, `redact` patterns.
* **Defect found by the tests and fixed:** a 200 response with an unparseable body threw a raw `SyntaxError` out of `get()`; it now throws `GitHubError("malformed JSON in 200 response")` (`lib/github.mjs`).
* **Verified (run here):** `npm test` 85 pass, 0 fail (55 importer + 16 client + 14 app/security).
* **Not done in B5:** collector resume/idempotence/incremental-run tests (next item).

## Item 6: collector tests (B5, rest)
* **Changed:** `collect.mjs#main(argv, { clientOptions })` accepts client options (fetch, sleep, retries) so the collector can run against a fake API; default behaviour unchanged.
* **Added:** `tools/upstream-import/test/collect.test.mjs` (6 tests, fake in-memory API with 2-item pages, temp output directories, no network, `GITHUB_TOKEN` unset): pagination across Link hops, PR items excluded from issues (and counted in the manifest), provenance fields and `collected_at` on every record, a completed run re-run makes zero list requests and leaves the file byte-identical, an interrupted run (`--max-pages 1`) resumes without duplicates or gaps, an incremental run sends `since`, replaces an edited record and adds a new one, a state file from another repository is refused.
* **Verified (run here):** `npm test` 91 pass, 0 fail.
* **Not done:** `--dry-run`, per-record `import_batch_id`, content-hash revisions and error retry counts (B4), still to come.

## Item 7: batch id and dry run (B4, part)
* **Changed:** `collect.mjs` stamps every record it fetches with `batch_id` (`batch-YYYYMMDD-HHMMSS`, second resolution, `-dry` suffix for dry runs) and records the id in the run entry of `state/collect.json`. `--dry-run` requests at most one page per list stage, skips pull-file retrieval, and writes no records, no state and no manifest (only the run log under `<out>/logs`).
* **Tests added (2, in `collect.test.mjs`):** batch id on every record and in the run state; dry run makes exactly 3 requests, creates no raw/state/manifest file, and a real run afterwards is unaffected.
* **Verified (run here):** `npm test` 93 pass, 0 fail.
* **Note:** the committed raw snapshot predates this field, so its records have no `batch_id`; the loader (B8) must treat it as optional and assign one batch to the snapshot. Content-hash revisions and per-error retry counts (rest of B4) remain.

## Item 8: migrations executed for the first time (B7, part)
* **Added:** `db/tests/run.mjs` (applies a Supabase stand-in `supabase_shim.sql` with roles `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`, then every migration in order, then every `*.test.sql`, on a fresh in-process Postgres via PGlite 0.3), `db/tests/package.json` (own dependency, so the app lockfile is untouched; the app tree has an unrelated `@cloudflare/workers-types` peer conflict, item R02), `db/tests/roles_rls.test.sql` (behaviour under `set local role` for anon, a plain user, a reviewer and service_role: reads, direct writes, every transition function, the importer function), `npm run test:db`.
* **Result:** migrations 0001 and 0002 apply on an empty database; both SQL suites pass.
* **Defects found by executing the SQL, and fixed:**
  1. `suppress_candidate` set `importable = false` while the candidate was still `published`, violating the table's own check constraint, so suppressing a published listing failed. Status, `importable` and the hold now change in one statement.
  2. `import_upsert_candidate` was revoked from client roles but never granted to the importer role; `service_role` got "permission denied". Explicit, role-existence-guarded grant added.
  * Also corrected a test expectation: a withdrawn candidate must be reopened before it can be approved again; the suppression gate P3 is tested after the reopen.
* **Mutation check (run once, ad hoc, not committed):** granting `anon` select on `candidate`, opening a reviewer policy to all users, and granting the importer function to `authenticated` were each caught by `roles_rls.test.sql`. Granting `anon` execute on `review_candidate` was not failed by a privilege error but is still refused by the function's own `is_reviewer()` check (two layers).
* **Limits (important):** PGlite is real Postgres compiled to WASM but is single-user and not Supabase: owner-role `BYPASSRLS`, platform default privileges and the real `auth.uid()`/JWT path are untested. The remaining half of B7 is applying to an empty staging server and re-running both suites.
