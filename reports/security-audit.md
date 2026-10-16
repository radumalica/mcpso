# Security Audit

Scope: the repository at `ddcdb9d`, exercised **only** against local fixtures (`tools/audit/fake-postgrest.mjs`); no real Supabase project, LLM, or production site was contacted or tested. Evidence: `reports/evidence/` (notably `api-probe/`, `ui/postgrest-requests.log`, `md-xss-probe.txt`, `secret-scan.txt`, `advisories-by-package.txt`).

Severity uses likelihood × impact for the *as-deployed-by-the-README* configuration. Confidence: **C** confirmed by execution or direct reading; **S** suspected, depends on configuration not present in the repository.
A caveat that applies to every database-related finding: **the production database policies (RLS) are not in the repository** (`data/install.sql` contains no `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`). The application writes with the *anon* key, so the app's writes can only succeed if the database allows anonymous writes; I report what the application code permits and flag where the real exposure depends on database configuration.

## 1. Summary table

| ID | Finding | Severity | Conf. | Affected |
|---|---|---|---|---|
| F-01 | Unauthenticated create/overwrite/soft-delete of any listing | **Critical** | C (app) / S (DB policy) | `app/api/submit-project*/route.ts`, `services/project.ts` |
| F-02 | Mass assignment + weak URL check: spoofed authorship, tracking-pixel and arbitrary-host URLs, `github.com.evil.example` accepted | High | C (executed) | `services/project.ts:17-54,172-206` |
| F-03 | Anon key doubles as write credential; schema ships with no RLS; `users` table holds e-mail and sign-in IP | High | S | `models/db.ts`, `data/install.sql` |
| F-04 | Unauthenticated, unbounded triggers of paid LLM and third-party fetches | High | C | `app/api/summarize-project*/route.ts` |
| F-05 | Production dependencies carry critical/high advisories (`next@15.0.4`: 37) | High | C | `package.json`, `dependency-audit.md` |
| F-06 | No rate limiting, abuse prevention, or request-size limits anywhere | High | C | all routes |
| F-07 | Stored-content abuse: LLM output derived from untrusted README is published verbatim (prompt injection → phishing links / SEO spam); attacker-chosen image URLs leak visitor IPs | Medium | C (flow) | `services/project.ts:85-170`, `templates/.../preview.tsx` |
| F-08 | PostgREST filter injection through `?q=` | Medium-Low | C (executed) | `models/project.ts:164-166` |
| F-09 | No security headers / CSP; third-party scripts run with full page privileges; upstream operator's GA/AdSense identifiers embedded | Medium | C | `next.config.mjs`, `providers/theme.tsx` |
| F-10 | Cross-origin writes accepted (JSON parsed regardless of `Content-Type`; no origin check) | Medium | C (reading) | `app/api/*/route.ts` |
| F-11 | Sensitive data in logs; error semantics hide failures | Low | C | `services/project.ts`, `utils/resp.ts` |
| F-12 | Privacy policy describes accounts/hosting that do not exist; schema stores `signin_ip` | Low (compliance) | C | `app/(policy)/privacy-policy/page.tsx`, `data/install.sql:1-14` |
| F-13 | Client polls `api.github.com` every 6 s per visitor | Low | C | `hero/github.tsx` |
| F-14 | No CI, so no automated dependency, secret, or SAST gate | Medium | C | repository root |

### Negative results (looked for, not found)

* **Stored/reflected XSS via Markdown:** `markdown-it` 14.1.0 with `html:false` (default) escapes raw HTML and refuses `javascript:`, `data:` and `vbscript:` links; executed probe in `md-xss-probe.txt` (fixture summaries containing `<script>` and `javascript:` links rendered as inert text, see `ui/server-mobile.png`). Residual risk is ReDoS in `markdown-it` (see `dependency-audit.md` D-03), not script injection.
* **SQL injection:** all queries go through PostgREST via `supabase-js` (no raw SQL), with the one filter-grammar exception in F-08.
* **SSRF from the server's own network:** `sumProject` rebuilds a `raw.githubusercontent.com` URL from the parsed owner/repo and sends it to the third-party `r.jina.ai`; the app never fetches attacker-chosen hosts itself. Residual: Jina fetches whatever URL is stored in a row; rows with non-GitHub URLs can only be produced via F-02 + direct DB access.
* **Open redirects, path traversal, file upload, session fixation, CSRF-with-cookies:** no redirect, filesystem, upload, or session code exists.
* **Committed secrets:** none found by regex over the working tree and all 20 commits (`secret-scan.txt`). Limitation: no entropy-based scanner was available (gitleaks/trufflehog not installed). `.env*` is git-ignored and none is tracked.

## 2. Findings in detail

### F-01: Unauthenticated writes to the catalogue: **Critical** (C for the app; S for production DB)

* **Evidence:** `app/api/submit-project/route.ts:8-26` has no authentication, authorisation, or origin check. Executed against the fixture: a single anonymous `POST /api/submit-project` with an existing `name` produced `PATCH /rest/v1/projects?uuid=eq.…` and returned the merged row with `"title":"OVERWRITTEN"`, `"status":"deleted"`, `"sort":999` (`reports/evidence/api-probe/results.txt`, request log). `debug/apitest.http` shows operators using the same endpoint with `"status": "deleted"`.
* **Prerequisites:** network access to the site; the production database must permit the anon role to `UPDATE`/`INSERT` on `projects` (it must, or the feature the README documents could not work).
* **Impact:** any visitor can deface, hijack (replace `url` with a phishing target), de-list, or spam the entire catalogue; there is no audit trail or undo.
* **Remediation:** remove these endpoints from the public app. Writes go through an authenticated operator path (or the future ingestion service) using a server-only credential; enable RLS with read-only `anon` policies; add an append-only `submission_events` table so every change is attributable. Add integration tests that assert 401/403 for anonymous writes.
* **Confidence:** C (behaviour) / S (database exposure).

### F-02: Mass assignment and incomplete input validation: High (C)

* **Evidence (executed):** (a) `{"url":"https://github.com.evil.example/x/y"}` was accepted and stored because the check is `startsWith("https://github.com")` (`services/project.ts:23`). (b) A new listing with `author_name:"Anthropic (official)"`, `avatar_url:"javascript:alert(1)"` and `img_url:"https://tracker.example/pixel.gif"` was stored verbatim (`results.txt`). The server does override `uuid`, `status`, `sort`, `is_featured`, `created_at` for *new* rows (`services/project.ts:189-197`), but **not for existing rows** (F-01), and never validates `author_name`, `avatar_url`, `img_url`, `title`, `description`, `tags`, `category`, `summary`, `content`.
* **Impact:** impersonation of vendors, visitor tracking, phishing links presented under a trusted GitHub-looking badge, oversized/garbage content.
* **Remediation:** schema validation (explicit allow-list of fields, URL parsing with `new URL()` and exact host equality), derive every non-user-supplied attribute server-side, length limits, reject unknown keys. React 19 refuses `javascript:` URLs in `href`, but do not rely on it **[S]**.

### F-03: Anon key as write credential; no RLS; PII table: High (S)

* **Evidence:** `models/db.ts:3-10` builds every client from `SUPABASE_ANON_KEY`; `data/install.sql` has no RLS. The `users` table stores `email`, `signin_ip`, `signin_openid` (`install.sql:1-14`) and Supabase's default PostgREST exposure makes every table in the `public` schema reachable with the anon key unless RLS is enabled.
* **Impact if RLS is off in production:** anyone with the publicly shipped anon key (which also appears in network traffic of any deployment that uses it client-side) can read every row of `users`, and read/write/delete `projects` and `categories` directly, bypassing the application entirely.
* **Remediation:** enable RLS on all tables; deny by default; `SELECT` only on published listings for `anon`; drop the unused `users` table; keep a service-role key only in the ingestion worker. **Verify** against the live project (`SELECT relname, relrowsecurity FROM pg_class …`): not possible from this repository.

### F-04: Unauthenticated, unbounded paid operations: High (C)

* **Evidence:** `summarize-projects` accepts `{page, limit}` from the caller and runs one Jina fetch + one LLM completion per project with `Promise.all` (`app/api/summarize-projects/route.ts:10-21`). `limit: 100000` was passed to the database unmodified (`results.txt`: `…summary=is.null…limit=100000`). A single call can start thousands of concurrent outbound requests and LLM completions.
* **Impact:** unbounded spend on the LLM key, Jina quota exhaustion, edge-function timeouts, and writes of model output into the catalogue by whoever calls first.
* **Remediation:** remove from the public surface; run enrichment as a rate-limited, concurrency-capped job (queue with max N in flight, per-day budget, kill switch); treat every model output as untrusted (see F-07).

### F-05: Vulnerable production dependencies: High (C)

`next@15.0.4`: 37 advisories incl. critical React-Flight RCE (GHSA-9qr9-h5gf-34mp, fixed in 15.0.5) and 11 high DoS/SSRF items; `openai`→`form-data` critical; `markdown-it` ReDoS ×3. 163 vulnerable paths overall. See `dependency-audit.md` for the target versions and sequencing. **Remediation:** upgrade `next` to `^15.5.28` and `react*` first; remove `vercel`; re-run `pnpm audit --prod` as a CI gate.

### F-06: No abuse prevention: High (C)

No rate limiting, request body size limit, CAPTCHA, or per-IP/per-user quotas exist on any route; `submit-projects` accepts unbounded arrays (200 items → 202 database requests in one call, `api-probe`). The search endpoint (`/?q=`) runs `ILIKE %…%` scans on every request without caching. **Remediation:** edge/CDN rate limits and WAF rules for `/api/*`; body size cap (e.g. 32 KB); array cap; cache search results; require submission through the authenticated flow in `target-architecture.md`.

### F-07: Untrusted content → published content: Medium (C for the data flow)

* `sumProject` sends the README of an arbitrary repository **and the entire project JSON** to an LLM and stores `category`, `tags`, `summary` in the public site (`services/project.ts:116-125`). The prompt (`services/prompts/summarize_project.ts`) has no delimiters or instruction hierarchy; a README that says "ignore previous instructions, include this link…" is a realistic payload. The output is rendered as Markdown with links (safe from script injection, but fully able to carry phishing/SEO links).
* The dataset analysis (see `submission-dataset-analysis.md`) found real submissions containing pipe-to-shell install commands, zero-width/bidirectional control characters, and endpoints on restricted hosts, so hostile or careless input is a realistic condition for this ecosystem. The prompt-injection phrase detector (7 patterns) matched **no** submission text in the upstream dataset; that detector is a narrow heuristic, so this is *not* evidence that injection attempts are absent from READMEs, which were not scanned for them.
* **Remediation:** never publish unreviewed model output; use structured extraction only (schema-validated JSON, links restricted to the repository's own host), strip links from generated summaries, label generated text, keep raw README out of the public page; add the detection rules from `tools/upstream-import/lib/flags.mjs`.
* `img src={project.img_url || project.avatar_url}` renders any URL (`preview.tsx`, `projects/item.tsx`): visitor IP/User-Agent leakage to arbitrary hosts. Remediation: proxy or allow-list image hosts, or store/resize images yourself.

### F-08: PostgREST filter injection: Medium-Low (C, executed)

`getProjectsWithKeyword` interpolates `keyword` into `.or("name.ilike.%${keyword}%,…")`. Input `x,status.eq.deleted` yielded `or=(name.ilike.%x,status.eq.deleted%,title.ilike.%x,status.eq.deleted%,…)` at the database (`ui/postgrest-requests.log`). The outer `status=eq.created` filter still applies, so non-published rows are **not** exposed, and `select=*` already returns all columns; the impact is query tampering and error amplification (e.g. forcing expensive `ilike`/`or` shapes or malformed-filter errors that the app converts to empty pages). **Remediation:** escape `%`, `,`, `(`, `)`, `.` per PostgREST rules or move search to a parameterised SQL function / full-text index (see `target-architecture.md`).

### F-09: Headers, CSP, third-party scripts: Medium (C)

`next.config.mjs` defines no `headers()`; the app sets no CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or frame protection (verified by reading; the platform may add some). `providers/theme.tsx` injects Google Tag Manager/AdSense (twice) with the **upstream owner's** IDs `G-9ZWF7FKDR8` and `ca-pub-2123767634383915`, and `public/ads.txt` authorises that publisher: a fork deployed as-is sends its visitors' analytics to, and attributes ad revenue to, a third party. **Remediation:** remove inherited identifiers; add a strict CSP and security headers; load analytics only after consent (or use a privacy-preserving, self-hosted alternative).

### F-10: Cross-origin writes: Medium (C by reading)

`await req.json()` parses the body regardless of `Content-Type`, and there is no origin/CSRF check or CORS policy. Any web page can make a visitor's browser send a no-preflight `text/plain` POST that the handler parses as JSON; because the API is unauthenticated anyway this mainly lets an attacker distribute abuse across many victim IPs (defeating IP-based limits). Not executed. **Remediation:** require `Content-Type: application/json`, authenticated sessions or tokens, and an origin allow-list once endpoints are authenticated.

### F-11: Logging and error semantics: Low (C)

`console.log` prints whole project rows, README content, Jina responses, and the LLM base URL and parameters (`services/project.ts:67,103,109,152,158`, `reader/jina.ts:7,26`). Errors are reported as HTTP 200 with `code:-1`. **Remediation:** structured logger with redaction, correct HTTP status codes, request IDs.

### F-12 / F-13 / F-14: lower-severity items

* **F-12:** the privacy policy and terms describe "MCP server hosting", accounts, and "usage metrics" that this application does not offer, and name `mcp.so`; the schema nevertheless defines `signin_ip` (unused). Rewrite policies to reflect actual processing (analytics, ads, logs) before launch.
* **F-13:** the star counter polls `api.github.com` unauthenticated every 6 s per browser tab (`github.tsx:19-33`); it exhausts the 60 req/h/IP limit in ~6 min and leaks visitors' IP to GitHub on every page view. Fetch server-side with caching instead.
* **F-14:** no CI at all (`reports/evidence/ci-config.txt`), therefore also no least-privilege token configuration to audit. When CI is added: `permissions: contents: read` by default, pin third-party actions to commit SHAs, no secrets in `pull_request` workflows from forks, OIDC for deployment, `pnpm audit --prod` and a secret scanner as required checks.

## 3. Supply-chain and CI/CD review

| Area | State | Recommendation |
|---|---|---|
| Lockfile integrity | two lockfiles that disagree (`package-lock.json` stale); `pnpm install --frozen-lockfile` passes | keep only `pnpm-lock.yaml`; CI uses `--frozen-lockfile` |
| Install scripts | none in root; transitive scripts not enumerated | install with `--ignore-scripts` in CI; allow-list builds explicitly |
| Dependency confusion | unscoped private package name, `private: true` | acceptable; claim scoped names if packages are ever published |
| Untrusted build inputs | none (no remote code at build time) | keep it that way; never `npm install` imported MCP repositories on build hosts |
| Containers | no Dockerfile | when added: pin base image by digest, non-root, read-only rootfs, no build secrets in layers |
| CI/CD tokens | no CI | see F-14 |
| Provenance | none | enable npm provenance / SLSA attestations for any published artefact |

## 4. Controls required for the future MCP verification pipeline

The registry will ingest thousands of third-party repositories (the upstream dataset alone refers to ≥ 3,500 distinct GitHub repositories). Assume **every submission is hostile**: READMEs, manifests, install scripts, tool descriptions and server output may all be crafted to attack the verifier, the maintainers, or end users. Static inspection and dynamic execution must be separate stages with separate privileges.

### 4.1 Stage separation

| Stage | What it may do | What it must never do |
|---|---|---|
| **S0 Metadata** (done in this audit) | Parse submission text; call GitHub REST/GraphQL; read manifest *text* | execute, install, or fetch arbitrary hosts |
| **S1 Static repository inspection** | Fetch a tarball/zip of a pinned commit via the API; parse manifests, lockfiles, `server.json`; license detection (SPDX); dependency vulnerability lookup (OSV) from lockfile contents; secret scanning; flag install scripts | run any code from the repo, run its package manager, follow arbitrary URLs from its content |
| **S2 Build sandbox (opt-in per project)** | Install dependencies *offline from a pre-fetched, hash-checked cache* where possible; build with scripts disabled by default | have network, secrets, Docker socket, or write access outside its scratch volume |
| **S3 Protocol test (opt-in, stdio or remote)** | Start the server in an ephemeral sandbox and run a bounded MCP `initialize` + `tools/list` conversation | call tools with real credentials; run indefinitely |
| **S4 Remote endpoint probe (opt-in)** | A few well-formed requests from an egress-controlled prober to a *public* HTTPS endpoint after DNS/IP validation | be reachable from the worker network except through the proxy; follow redirects to internal ranges |

Each stage writes a **distinct evidence level** (metadata validated → repository inspected → build passed → MCP protocol test passed → remote endpoint reachable → security checks performed); the UI must never collapse these.

### 4.2 Sandbox requirements for S2/S3 (any dynamic execution)

* **Ephemeral, single-use** microVM or gVisor/Firecracker/Kata-style sandbox per job; destroyed on completion or timeout; no reuse between submissions.
* **Hard limits:** CPU (e.g. 1 vCPU), memory (e.g. 512 MB-1 GB), disk (tmpfs/overlay quota), wall-clock (e.g. 60-120 s install/build, 30 s protocol test), PID/thread limit, open-file limit, no swap; a watchdog that kills the whole process tree and the sandbox.
* **No host Docker socket**, no privileged containers, no `--cap-add`, seccomp + AppArmor/SELinux default-deny profile, `no-new-privileges`, user namespaces, **non-root** UID, read-only root filesystem, a single explicit writable scratch directory, noexec where practical.
* **No application secrets:** the sandbox receives an empty environment. Credentials for servers that need them are *test* credentials issued per job, scoped to a throwaway account, never production keys. Redact tokens in logs with the same patterns used in `tools/upstream-import/lib/github.mjs::redact` plus entropy checks.
* **Network:** default **deny**. For S2, only an allow-listed package-registry mirror/proxy (read-only, with `--ignore-scripts` semantics enforced by the runner). For S3, no egress. For S4, egress only via an SSRF-hardened prober: resolve DNS once, reject private/loopback/link-local/metadata ranges (`169.254.169.254`, `fd00::/8`, `100.64.0.0/10`, IPv4-mapped IPv6, decimal/hex/octal host encodings: see `lib/urls.mjs::isRestrictedHost` for the textual part), pin the resolved IP for the connection, block redirects to different hosts, cap response size and time, and never forward credentials.
* **No access to cloud metadata or internal services:** run workers in a separate VPC/account/project with no route to the application network or database.
* **Supply-chain controls inside the sandbox:** `npm ci --ignore-scripts`, `pip install --no-deps --only-binary` where possible, locked hashes (`--require-hashes`), refuse packages whose resolved tarball hash differs from the registry's recorded integrity; typosquat and install-script heuristics as *review flags*, not verdicts.
* **Process hygiene:** disallow `setsid` escape, background daemons, fork bombs (PID cgroup), outbound DNS tunnelling (no DNS), crypto-mining signatures (CPU cap makes it uneconomical), and persistence outside scratch.
* **Safe cleanup after failure:** teardown is in a `finally`/supervisor path independent of the job code; orphaned sandboxes are reaped by TTL; scratch is wiped; the job record is marked `failed` with a reason code, never left `running` (see stalled-job detection in `target-architecture.md`).
* **Audit trail:** every job logs who/what requested it, repo URL + commit SHA, sandbox image digest, limits applied, network policy, start/end, exit status, resource usage, and the evidence it produced; logs are append-only and redacted.
* **Output is untrusted too:** tool lists/descriptions returned by a server must be sanitised before display (they are a prompt-injection channel to end users' LLM clients), size-capped, and shown as quoted data, not rendered as Markdown with links.

### 4.3 What can be automated safely vs what needs people

| Check | Automate? | Notes |
|---|---|---|
| Canonical identity, duplicate detection, license (SPDX) | Yes | pure metadata |
| Dependency vulnerability lookup from lockfile contents | Yes | no install required |
| MCP SDK dependency / `server.json` detection | Yes | static; already implemented as evidence signal E2 |
| Repository activity/archived/fork | Yes | GitHub API |
| Build | Opt-in, sandboxed | never on the control plane |
| Protocol test for stdio servers | Opt-in, sandboxed | needs a runnable entry point; many servers need credentials → "requires credentials" is a legitimate terminal status |
| Remote endpoint probe | Opt-in, only for owner-verified endpoints | prove ownership first (DNS TXT or `/.well-known` file) before probing |
| Servers needing paid third-party accounts | Human or owner-attested | do not fabricate a pass |
| Malicious-behaviour judgement | Human review for flagged items | automated signals only prioritise the queue |

## 5. Prioritised remediation (security)

1. **P0:** F-01/F-02/F-04: take the write and LLM-trigger routes offline or behind authentication; verify RLS in the live project (F-03).
2. **P0:** upgrade `next`/`react`, remove `vercel` (F-05).
3. **P1:** rate limiting + body limits (F-06), remove inherited GA/AdSense identifiers and add security headers/CSP (F-09), correct HTTP status codes and logging (F-11).
4. **P1:** treat model output and README text as untrusted (F-07); allow-list image hosts.
5. **P2:** CI with audit/secret/SAST gates (F-14); fix search escaping (F-08); privacy policy (F-12).
