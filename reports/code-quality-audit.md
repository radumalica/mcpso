# Code Quality Audit

Commit audited: `ddcdb9d`. All 60 tracked source files were read. Confidence: **[C]** confirmed by execution or direct reading, **[S]** suspected.
Commands and outputs: `reports/evidence/` (`tsc.txt`, `tsc-after-next-env.txt`, `build.txt`, `build-patched-copy.txt`, `next-lint.txt`, `test-script.txt`, `unused-deps.txt`).

## 1. Static analysis and test results (actually executed)

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | **Fails: 1 genuine error** (`search/index.tsx(25,34) TS2315: Type 'KeyboardEvent' is not generic`; `KeyboardEvent` is used without importing it from `react`, so TypeScript falls back to the DOM global). The first run also showed 4 × TS2307 for `.svg` imports; these were an **audit-environment artifact** (a clean checkout has no `next-env.d.ts`; they vanish after `next dev/build` generates it, see `tsc-after-next-env.txt`). |
| Production build | `next build` (dummy env) | **Fails** on the same type error (`build.txt`). |
| Production build, patched *copy* | same, with the one missing import added in a throwaway copy | **Passes**; route sizes in §4 (`build-patched-copy.txt`). So the type error is the only build blocker. |
| Lint | `next lint` | **Cannot run**: no ESLint config or `eslint` dependency; Next prompts interactively ("How would you like to configure ESLint?"), exit 1 (`next-lint.txt`). The build's lint phase is therefore a no-op. |
| Unit / integration / e2e tests | n/a | **None exist**: no `test` script, no test files, no test framework (`test-script.txt`). Coverage is 0% by absence. |
| Dependency vulnerability scan | `pnpm audit`, `npm audit` | **163 findings via pnpm** (7 critical, 80 high, 60 moderate, 16 low; 143 distinct advisories); see `dependency-audit.md`. |
| Secret detection | regex scan of tree + all 20 commits (`tools/audit/secret-scan.sh`) | No secret-shaped strings found. **Limitation:** gitleaks/trufflehog are not installed, so this is a pattern scan, not an entropy-aware scanner. Public IDs (AdSense, GA) are present but are not secrets. |
| SAST | semgrep / bandit | **Not run: not installed.** Next action: add `semgrep --config p/typescript --config p/nextjs` in CI. Manual review substitutes in `security-audit.md`. |

## 2. Confirmed defects (ordered by impact)

| ID | Defect | Impact | Conf. | Location |
|---|---|---|---|---|
| Q-01 | **Build-breaking type error** (see above) | Cannot deploy a clean checkout | C | `templates/tailspark/landing/components/search/index.tsx:25` |
| Q-02 | **Search input is disabled forever after the first search.** `handleSubmit` calls `setInputDisabled(true)` after `router.push`; the only code that re-enables it is a `useEffect` on the `query` prop, but `<Search />` is rendered with **no props** (`pages/index.tsx:20`), so the effect never runs. (History, from `git show`: merged PR #8 (`e96b3ed`) tried to fix this with `router.events.on('routeChangeComplete', …)`, which is a **Pages Router** API and does not exist in the App Router; commit `a811b95` ("update search component") then deleted that effect, which restored the original bug.) | Core feature broken: user must reload the page to search again | C (source); not browser-tested | `search/index.tsx:17,39,46-51`, `pages/index.tsx:20` |
| Q-03 | `parseProject` accepts `https://github.com.evil.example/...` because it checks `url.startsWith("https://github.com")`; verified: the probe stored a listing for that host | Arbitrary non-GitHub URLs listed as GitHub projects | C (executed) | `services/project.ts:23`, `reports/evidence/api-probe/results.txt` |
| Q-04 | `parseProject` **mutates its argument** and `saveProject` forwards the **entire request body** to the database (mass assignment): `uuid`, `status`, `sort`, `is_featured`, `avatar_url`, `img_url`, `author_name`, `summary`, `content` are all client-controlled; for an existing name an `UPDATE` is issued with attacker data | Overwrite/soft-delete any listing; spoof authorship | C (executed against fixture) | `services/project.ts:17-54,172-206` |
| Q-05 | **Every API error returns HTTP 200** (`Response.json(json)` defaults to 200; failure is only `code:-1` in the body); invalid JSON, DB failure, and validation errors are indistinguishable to HTTP clients and monitors | No usable monitoring/retry semantics | C | `utils/resp.ts:13-24`, probe `malformed` |
| Q-06 | `submit-projects`: `if (!parsedProjects)` / `if (!savedProjects)` are always false for arrays; invalid items are silently dropped by `.filter`; `Promise.all` over unbounded input means one rejection discards the whole response **after** earlier writes already happened (partial commit, no report of which succeeded) | Silent data loss, no idempotency | C | `app/api/submit-projects/route.ts:12-24` |
| Q-07 | Models convert **all** database errors into "empty result" (`if (error) return []/0/undefined`); outage ⇒ site shows 0 servers, status 200, nothing logged | Outages are invisible; SEO risk if crawled during an incident | C | `models/project.ts:28,44,63,75,90,111,131,149,172,197`; `models/category.ts:25,42` |
| Q-08 | **Pagination is absent.** Home = first 100 *featured* rows, category = first 300, search = first 100; no `page` parameter, no total, no next link; `getProjectsCount` is used only for the hero number. With ~5,000 candidate servers in the upstream dataset, ≥ 95% of the catalogue would be unreachable except via search. | Content unreachable; SEO | C | `app/(default)/page.tsx:22-24`, `category/[cate]/page.tsx:57` |
| Q-09 | `getRandomProjects(1,50)` fetches the **same 50 rows** every time (ordered by `sort, created_at`) and then shuffles them with `sort(() => Math.random() - 0.5)` (a biased shuffle); "View More" is therefore the same 50 newest servers on every page | Poor discovery; misleading name | C | `models/project.ts:136-152` |
| Q-10 | Read-then-write race in `saveProject` (`findProjectByName` → `insertProject`); `name` is `UNIQUE`, so two concurrent submissions of the same name yield a unique-violation exception that surfaces as a generic HTTP-200 failure. No upsert, no idempotency key | Duplicate/lost submissions under concurrency | C (reasoning) | `services/project.ts:180-199` |
| Q-11 | `getCategories` returns `projects_count` as an **unawaited Promise** (1 + N queries per request). React 19 resolves it while rendering, so numbers display correctly (verified), but the type contract is wrong and the cost is O(categories) round-trips | Latency, untestable data shape | C | `models/category.ts:44-47` |
| Q-12 | `getProjectsCount` uses `.select("count")`; this only works when PostgREST aggregates are enabled and otherwise silently yields 0 via Q-07 | Hero count may read "0" | S | `models/project.ts:68-78` |
| Q-13 | **Filter injection** in keyword search: user text is interpolated into PostgREST's `or=(…)` grammar unescaped. Input `x,status.eq.deleted` produced `or=(name.ilike.%x,status.eq.deleted%,…)` (captured in `reports/evidence/ui/postgrest-requests.log`). The outer `status=eq.created` still ANDs, so deleted rows are not exposed; impact is limited to query manipulation and errors, but it is not parameterised | Query tampering, error amplification | C (executed) | `models/project.ts:164-166` |
| Q-14 | `console.log` of full objects, including `process.env`-derived LLM base URL and request params, project content, and Jina responses (up to whole READMEs) | Log noise/cost; potential sensitive-data exposure in logs | C | `services/project.ts:67,103,109,152,158`, `services/reader/jina.ts:7,26` |
| Q-15 | Missing environment variables are replaced by empty strings (`process.env.SUPABASE_URL || ""`), so misconfiguration fails late and obscurely instead of at startup | Hard-to-diagnose deploy failures | C | `models/db.ts:4-7` |

## 3. Patterns that do not meet the project's stated standards

* **Immutability:** `parseProject` and `sumProject` mutate their inputs (`project.name = …`, `project.content = …`).
* **Validation at boundaries:** no schema validation anywhere (no zod/valibot); `req.json()` results are cast with a TypeScript type that provides no runtime guarantee.
* **Type safety:** 3 `any` uses (`utils/resp.ts`, `models/user.ts`); `process.env.OPENAI_MODEL as string`; the `Project` interface marks almost every column optional, so it describes *requests* and *rows* simultaneously; DB types are not generated from the schema.
* **Function size / cohesion:** acceptable (largest file 206 lines), but `services/project.ts` mixes five responsibilities (parse, fetch, LLM, persist, URL derivation).
* **Error handling:** inconsistent: some functions `throw`, some `return undefined`, some swallow; no error type, no request IDs.
* **Duplicated logic:** `getIsoTimestr` defined twice; five near-identical `select … .eq("status") … .order … .range` queries instead of one query builder; two page components sharing the same metadata pattern.
* **Dead code:** `models/user.ts` (3 functions, `users` table), `extractProject`, `genUniSeq`, `parseEventData`, `isSmScreen`, `removeYamlMarkers`, `genNonceStr`, `bytesToKB/MB`, `upperFirstChar`, `removeUrlSearchParams`, `getTimestamp`, `getMillisecond`, `msToSeconds`, `respOk`, `insertCategory`, `hero/producthunt.tsx` are never referenced (checked with a repository-wide search); 2 declared dependencies (`xmlbuilder`, `next-themes`) are never imported.

## 4. Front-end efficiency (measured on a patched throwaway copy; `build-patched-copy.txt`)

| Route | Route JS | First Load JS | Observation |
|---|---|---|---|
| `/` | 41 kB | **175 kB** | FAQ accordion pulls `framer-motion`; `moment` for relative time |
| `/[slug]/[name]` (server detail) | 1.28 kB | **481 kB** | `components/markdown` is a Client Component, so `markdown-it` + the **full `highlight.js`** language set ship to every visitor to render *static* text |
| `/privacy-policy`, `/terms-of-service` | 0.5 kB | **446 kB** | same cause: static legal text rendered client-side |
| `/categories`, `/category/[c]` | ~1 kB | 135 kB | fine |

* Every route that queries the database is dynamic (edge) and **uncached** (no `revalidate`, no `Cache-Control`): each visit costs 3-8 PostgREST queries (`reports/evidence/ui/postgrest-requests.log`).
* The server detail page calls `findProjectByName` twice (metadata + body).
* `moment` (maintenance-mode library) is imported for `fromNow()` in two components.
* The viewport meta disables zoom (`maximum-scale=1, user-scalable=no`, `app/layout.tsx:25`): an accessibility defect (WCAG 1.4.4).

## 5. Test strategy gap

Critical business logic with **zero** tests: URL canonicalisation, submission parsing/merging, category assignment, pagination, search. Recommended first tests (all can be pure-function tests with no database): canonical repo key (already implemented and tested in `tools/upstream-import/test/urls.test.mjs` as a reference implementation), submission schema validation, status-transition rules, search query building (with injection cases).

## 6. Prioritisation

1. Q-04, Q-03, Q-05, Q-06 (security-relevant correctness; fix with authentication and schema validation: see `security-audit.md`).
2. Q-01, Q-02 (build + core feature) - one-line and ~5-line fixes respectively.
3. Q-07, Q-08, Q-11 (observability and discoverability).
4. Bundle weight (move Markdown to a Server Component; drop `moment`, `framer-motion`).
5. Remove dead code and unused dependencies.
