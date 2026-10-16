# Implementation Log (branch `impl/v5-phase-a`)

Tracks coding done against `master-plan-v5.md` / `implementation-checklist.md`. One commit per finished item. Each entry: what changed, how it was verified (command and result), and what remains. Nothing here deploys, publishes or touches a production database. Statements of "passes" refer to commands actually run in this worktree.

| # | Checklist item | Status | Commit |
|---|---|---|---|
| 0 | Branch and log | done | see `git log` |
| 1 | A5 (part): fix the build-breaking type error and the self-disabling search (audit Q-01, Q-02, U-02) | done | see `git log` |
| 2 | A4 / R01: remove public write and LLM-trigger endpoints; regression guard; `test`/`typecheck` scripts (F-01, F-02, F-04, F-10) | done | see `git log` |
| 3 | A3 (part): remove inherited analytics/ads, fake star rating, upstream star widget, zoom lock, upstream-host sitemaps and ads.txt | done | see `git log` |

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
