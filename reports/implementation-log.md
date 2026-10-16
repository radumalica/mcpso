# Implementation Log (branch `impl/v5-phase-a`)

Tracks coding done against `master-plan-v5.md` / `implementation-checklist.md`. One commit per finished item. Each entry: what changed, how it was verified (command and result), and what remains. Nothing here deploys, publishes or touches a production database. Statements of "passes" refer to commands actually run in this worktree.

| # | Checklist item | Status | Commit |
|---|---|---|---|
| 0 | Branch and log | done | see `git log` |
| 1 | A5 (part): fix the build-breaking type error and the self-disabling search (audit Q-01, Q-02, U-02) | done | see `git log` |

## Item 1: search component and clean build
* **Changed:** `templates/tailspark/landing/components/search/index.tsx` rewritten as a real search form (`role="search"`, native submit so Enter and IME composition work, labelled input, submit button with accessible name, `maxLength` 200, never disabled, pending state via `useTransition`). Removed the invalid global `KeyboardEvent<...>` usage and the `inputDisabled` state that disabled the box after the first search.
* **Verified (run in this worktree):** `node_modules/.bin/tsc --noEmit` reports no errors (baseline before the change: 1 error, TS2315 at this file); `node_modules/.bin/next build` completes and lists all routes (first-load JS unchanged: `/` 175 kB, `/[slug]/[name]` 481 kB).
* **Not verified:** interactive behaviour in a browser (no test harness exists yet; component tests come with the test setup in a later item).
* **Observed, not mine:** `reports/master-plan.md` and `reports/master-plan-changelog.md` are deleted in the working tree (unstaged) and were not touched by this work; they are left as found.
