# Executive Summary

> **Scope update (master plan v5):** the product is an independently operated registry built by enhancing this codebase; the historical upstream addition requests are imported, deduplicated, evaluated and selectively published (R07), with its own brand, infrastructure and data model, and without upstream branding or runtime dependence. Importing, eligibility and approval are separate concepts; the MVP scope is reduced. See `master-plan-v5.md`, `mvp-feature-matrix.md` and `publication-gate-checklist.md`.

**Subject:** fork `radumalica/mcpso` of `chatmcp/mcpso` (the free variant of mcp.so), audited 2026-10-16 as the starting point for a free, independent, professional MCP registry.
**Nature of this work:** audit and planning only. No application code, dependency, schema or deployment configuration was changed. Every statement below is tagged **C** (confirmed by execution or direct reading), **S** (suspected; plausible but not demonstrable from the repository alone) or is a measured count with its denominator. Detail and evidence are in the numbered reports in this directory and `reports/evidence/`.

## 1. Repository health

A small (~2,700 TypeScript lines, 20 commits) Next.js 15 / React 19 directory app: static-ish listing pages over a Supabase (PostgREST) table, three API routes for submitting and LLM-summarising projects, edge runtime, deployed with the deprecated `@cloudflare/next-on-pages`. There is **no authentication, no tests, no CI, no lint configuration, no error/not-found pages, no pagination**, and two inconsistent lockfiles. It works as a demo; it is not a foundation to harden but a prototype to replace behind a cleaner data model (`target-architecture.md`). The visible product is a thin card grid with an inherited upstream brand, analytics and ad identifiers.

## 2. Confirmed problems (top)

* **Unauthenticated write access to the catalogue (C).** An anonymous `POST /api/submit-project` created, overwrote and soft-deleted listings, accepted `github.com.evil.example` as a GitHub URL, and let the caller spoof author, avatar and image fields (executed against a PostgREST fixture; `evidence/api-probe/`).
* **Build is broken on a clean checkout (C).** `tsc` reports one genuine error (`templates/tailspark/landing/components/search/index.tsx:25`, `KeyboardEvent` is not generic) and `next build` fails on it; `npm ci` fails with ERESOLVE (lockfile pins `next` 15.0.3 vs `package.json` 15.0.4); only the pnpm lockfile installs.
* **Search is unusable after first use (C).** The input is disabled after the first search and never re-enabled (Q-02).
* **Fake trust signal (C).** Every card shows a hard-coded 5-star rating; 201 of 205 images on the home page carry `alt="star"`.
* **Errors are invisible (C).** All API errors return HTTP 200; all DB errors become "empty result" (a database outage renders "0 servers").
* **No navigation on mobile, soft 404s with HTTP 200, no pagination (most of a large catalogue unreachable), pinch-zoom disabled (C).**

## 3. Critical security findings

See `security-audit.md` and `threat-model.md`. Critical: **F-01** public create/overwrite/soft-delete (C in the app; whether the production database also refuses it depends on RLS, which could not be inspected, S). High: **F-02** mass assignment and weak URL validation (C); **F-03** the anon key is the only credential and the shipped schema has no RLS, and a `users` table stores e-mail and sign-in IP (S); **F-04** unauthenticated, unbounded triggers of paid LLM calls (bulk endpoint: 200 items caused 202 database requests) (C); **F-05** vulnerable production dependencies (C); **F-06** no rate limiting anywhere (C). Negative results: markdown rendering did not execute script (executed XSS probe negative), no SQL injection beyond a PostgREST filter-grammar injection (F-08), and no secrets in the working tree or the 20 commits by regex scan (no entropy scanner was available).

## 4. Build, test and tooling results (actually executed)

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile --ignore-scripts` | succeeded (554 packages) |
| `npm ci` | **failed** (ERESOLVE, lockfile drift) |
| `tsc --noEmit` | 1 genuine error (Q-01); 4 further SVG-module errors were an environment artefact (no `next-env.d.ts`) and are not counted |
| `next build` (as committed) | **failed** on Q-01 |
| `next build` on a throwaway copy with that one line patched | succeeded; first-load JS: home 175 kB, detail page 481 kB, legal pages 446 kB, category 135 kB |
| `next lint` | not runnable (blocks on an interactive ESLint setup prompt; no config exists) |
| Application tests | none exist |
| Importer tests (`tools/upstream-import/test`, run as `node --test` on the four test files) | 31 of 31 passed |
| Secret scan (regex, tree + history) | no secrets found; limitation: no gitleaks/trufflehog installed |
| SAST (semgrep etc.) | not run (tools not installed) |
| Browser review | headless Chromium at desktop and 390 px; screenshots in `evidence/ui/`; no real-device, screen-reader or Lighthouse field testing |

## 5. Dependency risks

`pnpm audit`: 163 vulnerable paths across 143 advisories (7 critical, 80 high, 60 moderate, 16 low) in the 554-package tree. `next@15.0.4` alone has 37 advisories (4 critical); the fix target is the 15.5 line. The dev dependency `vercel` is the sole source of 7 vulnerable packages and is removable. 25 of 28 direct dependencies are outdated; `@cloudflare/next-on-pages` and `@types/uuid` are deprecated; `xmlbuilder` and `next-themes` are unused. Whether each advisory is reachable in this app was triaged only for the top `next` items; the rest are counts, not exploitability claims (`dependency-audit.md`).

## 6. Product deficiencies

No accounts or ownership proof, no real submission flow (submit = open a GitHub issue), no install/config snippet, no transport/auth/licence/tool list on the detail page, no maintenance signal, no categories beyond a flat list, no duplicate handling, no moderation or reviewer UI, no correction/removal path, inherited privacy and terms text describing a different operator, upstream GA and AdSense identifiers embedded, client polls GitHub's API every 6 s per visitor. Details in `ui-ux-audit.md`, `product-requirements.md`, `performance-seo-growth.md`.

## 7. Upstream dataset (actual counts)

Collected on 2026-10-16 (full collection, 0 API errors; `submission-dataset-analysis.md`): **4,869 issues** (4,403 open), **43 pull requests** (code contributions only; submissions are issues, not PRs), **2,412 comments** (1,450 on the submission thread #1), 2,801 distinct issue authors. Issue volume rose from 441 (Aug 2026) to 647 (Sep) to 925 in the first 16 days of Oct. 595 issue numbers in the range are unretrievable. The official MCP Registry snapshot holds **44,497 unique servers** (complete, 1,542 pages).

## 8. Deduplication and eligibility results

From 6,052 identity-bearing submission records: **4,868 candidate projects**; 1,184 duplicate records merged (19.6%); 197 renamed repositories mapped (21 candidates formed by joining records across a rename); 228 projects ambiguous. Of the 4,868 projects: **3,502 eligible (71.9%)**, **1,353 needs review (27.8%)**, **13 ineligible (0.3%)**; 3,467 are eligible and unblocked (no security flag, no removal hold; 26 eligible projects are security-flagged and 9 more are held for removal review); none is approved and none is published. Repositories: 3,530 of 3,966 resolved (89.0%), 436 not found or private, 48 archived. 36 projects carry a security flag (22 pipe-to-shell installs, 7 hidden-Unicode, 5 loopback/restricted endpoints, 2 possible official-scope impersonations); no prompt-injection signature matched. **Caveats that matter:** eligibility is public-evidence triage, **not verification or a security review**; 1,930 of the 3,502 eligible (55.1%) rest on cheap evidence only (registry listing and/or manifest file); the ineligible share is small by design because only positive evidence of out-of-scope rejects a project; 7 removal requests exist and 6 cannot be mapped to a project, which blocks affected entries until a human decides. A 71-project hand check found no clear false positives among 40 eligible samples, and about 3/5 of sampled `needs_review` N1 projects look like genuine servers; this is a sanity check, not a precision measurement.

## 9. Differentiation

Not another card grid: canonical identity and dedup; **evidence levels with dates** (declared / statically inspected / owner-verified / tested), never a bare score; transparent submission status with reasons; install snippets derived from manifests rather than submitter prose; maintenance and advisory signals; a working correction/removal path; free submission and open data export with attribution; static inspection first, execution only in a future isolated sandbox. The official registry is a metadata store, not a curated, deduplicated, evidence-labelled discovery product (`product-requirements.md`).

## 10. Next steps (see `prioritized-roadmap.md`, R01–R22)

1. **R01** remove the public write and LLM-trigger endpoints (S).
2. **R02** upgrade `next`/`react`, drop `vercel`, pick one lockfile.
3. **R03** fix the build and add CI (typecheck, build, audit, secret scan).
4. **R04** remove inherited analytics/ad IDs, branding, fake stars; adopt the new name after clearance (`rebranding-proposal.md`; finalists Cairnbase, Lodehaven, Cairnindex, none confirmed available, no trademark search done).
5. **R05** verify and enforce RLS in the live Supabase project (requires access I did not have).
Then the registry data model and review-queue import (R06–R07), authenticated submission (R08), and a rebuilt read experience (R09).

## 11. Findings table

Confidence: **C** confirmed, **S** suspected. Severity is for the registry's intended public deployment. F-, D-, U- severities are copied from the detailed reports; `code-quality-audit.md` rates Q- items by impact only, so the Q- severities here are assigned in this summary.

| ID | Severity | Conf. | Finding | Evidence | Files | Remediation |
|---|---|---|---|---|---|---|
| F-01 | Critical | C (app) / S (DB) | Unauthenticated create/overwrite/soft-delete | `evidence/api-probe/results.txt` | `app/api/submit-project*/route.ts`, `services/project.ts` | R01, then R05/R08 |
| F-02 | High | C | Mass assignment; `github.com.evil.example` accepted | api-probe request log | `services/project.ts:17-54,172-206` | validate with a schema allow-list; R08 |
| F-03 | High | S | Anon key as write credential; no RLS shipped; PII table | schema read | `models/db.ts`, `data/install.sql` | R05, R06 |
| F-04 | High | C | Unbounded paid-LLM/fetch triggers | 200 items → 202 DB requests | `app/api/summarize-project*/route.ts` | R01, R12 |
| F-05 (D-01..D-03) | High | C | 143 advisories; `next@15.0.4` 37 | `evidence/pnpm-audit.txt` | `package.json` | R02 |
| F-06 | High | C | No rate limiting or size limits | code reading, probe | all routes | R12 |
| F-14 | Medium | C | No CI/automated gates | repo listing | repo root | R03 |
| F-09 | Medium | C | No CSP/security headers; upstream GA/AdSense IDs | HTML capture | `next.config.mjs`, `providers/theme.tsx` | R04, R12 |
| F-10 | Medium | C | Cross-origin writes, content-type ignored | code reading | `app/api/*/route.ts` | R01, R12 |
| F-07 | Medium | C (flow) | LLM output from untrusted README published verbatim | code reading | `services/project.ts:85-170` | R01; sanitise and review (R10) |
| F-08 | Medium-Low | C | PostgREST filter injection via `?q=` | probe `x,status.eq.deleted` | `models/project.ts:164-166` | escape input, R13 |
| F-11/12/13 | Low | C | Sensitive logs, privacy-policy mismatch, 6 s GitHub polling | code reading | see `security-audit.md` | R04, R12 |
| Q-01 | High | C | Build-breaking type error | `tsc`, `next build` log | `templates/tailspark/landing/components/search/index.tsx:25` | R03 |
| Q-02 | High | C | Search disabled after first search | browser run, history | same component | R09 |
| Q-05/07 | High | C | HTTP 200 on every error; DB errors become empty results | code reading, probe | `utils/resp.ts`, `models/*.ts` | R09/R12 |
| Q-08 | High | C | No pagination; catalogue mostly unreachable | code reading | `models/project.ts` | R09 |
| D-04 | High | C | `npm ci` fails; two lockfiles | `evidence/npm-ci-dry-run.txt` | lockfiles | R02 |
| U-01 | High | C | Fake 5-star rating on every card | HTML capture | card/detail components | R04 |
| U-03/10 | High | C | No mobile navigation; zoom disabled | Chromium run | `app/layout.tsx:25` | R09 |
| DS | Info | C | 4,868 candidate projects, 3,502 eligible, 6 unmapped removal requests | `submission-dataset-analysis.md` | `data/upstream-import/classified/` | R07 |

## 12. Not done, and why

No dependency upgrades, code fixes, schema or deploy changes (forbidden by the brief). No live Supabase/RLS inspection, no production access. No gitleaks/semgrep (not installed; regex scan and manual review only). No execution of any imported MCP server and no probing of remote endpoints. No trademark search and no claim that any name or domain is available (RDAP/DNS/registry lookups only show what was checked, when). No Lighthouse field data, real-device or screen-reader testing. Extraction and classification accuracy were spot-checked, not measured. Advisory reachability was triaged only for the top `next` items.
