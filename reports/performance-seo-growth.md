# Performance, SEO and Growth

> **Scope update (master plan v5):** the product is an independently operated registry built by enhancing this codebase; the historical upstream addition requests are imported, deduplicated, evaluated and selectively published (R07), with its own brand, infrastructure and data model, and without upstream branding or runtime dependence. Importing, eligibility and approval are separate concepts; the MVP scope is reduced. See `master-plan-v5.md`, `mvp-feature-matrix.md` and `publication-gate-checklist.md`.

Measured items come from the audit runs (`reports/evidence/`); everything about *future* traffic is a recommendation or hypothesis. **No production metrics exist or were fabricated**: no public deployment was measured, no field data (CrUX/RUM) or Search Console access was available.

## 1. Current state (measured / read from source)

| Topic | Finding | Evidence |
|---|---|---|
| Rendering | All listing pages are dynamic Edge SSR, **uncached**; 3-8 database queries per view (detail page issues the same project query twice) | `ui/postgrest-requests.log`, `build-patched-copy.txt` ("Using edge runtime on a page currently disables static generation") |
| JS weight (first load, patched build) | `/` 175 kB · detail **481 kB** · legal pages **446 kB** · category 135 kB (shared 100 kB) | `build-patched-copy.txt` |
| Images | `loading` via a lazy-load library, plain `<img>` (no width/height, so layout shift is possible); avatars hot-linked from arbitrary hosts | `projects/item.tsx`, `preview.tsx` |
| Indexability | Real titles/descriptions/canonicals on list and detail pages; **no** Open Graph/Twitter/JSON-LD; missing items return **HTTP 200** with canonical to the missing URL (soft 404); `/anything/{name}` serves the detail page for any first segment (duplicate URLs); `robots.txt` has no `Sitemap:` line, blocks `?q=` (fine) and `/privacy-policy/` (trailing slash, so it doesn't match) | `ui/html-facts.txt`, `public/robots.txt` |
| Sitemaps | Static files in `public/` (308 project URLs + 20 categories) on host `mcp.so`; generator route absent from the repo | `unused-deps.txt` |
| Pagination | None; home shows ≤100, category ≤300 | Q-08 |
| Search | `ILIKE` over 3 columns, no ranking, no index | A-12 |
| Core Web Vitals | **Not measured.** Likely weak spots by inspection: CLS from un-sized images and card re-layout, INP from the 6-second GitHub polling and client Markdown hydration, LCP from the 481 kB detail bundle | n/a |

## 2. Technical SEO recommendations

1. **Status codes and canonicals:** return 404 for unknown servers/categories (`notFound()`), 410 for removed listings, 301 for renames/merged duplicates; drop the unused `[slug]` segment (use a single `/servers/{id-or-slug}` route); one canonical host from configuration validated at startup.
2. **Sitemaps:** generate from the database at build/revalidate time, **only for published, index-eligible listings** (below), split by 10-50k URLs, `lastmod` from real content change, referenced in `robots.txt`.
3. **Structured data:** `SoftwareSourceCode` / `SoftwareApplication` JSON-LD on listing pages (name, description, `codeRepository`, `programmingLanguage`, `license`, `dateModified`); `BreadcrumbList`; never include ratings or review markup (there are no ratings).
4. **Metadata:** unique title ("{Name} MCP server: install & config"), meta description generated from real fields (what it does + transport + language), OG/Twitter images (generated, not hot-linked), `<link rel="alternate" type="application/json">` to the API entry.
5. **Rendering & caching:** server-rendered pages with ISR (e.g. revalidate 10-60 min plus on-demand revalidation when a listing changes); stale-while-revalidate at the CDN; no per-request database fan-out.
6. **Pagination and faceting:** crawlable `?page=N` with `rel` canonical per page, `noindex,follow` on filter combinations beyond a small allow-list (category, language, transport), never index free-text search results (the existing `?q=` disallow is right).
7. **Images:** self-hosted/proxied avatars with explicit dimensions and modern formats; remove hot-linking (also a privacy fix).
8. **Performance budget:** detail page first-load JS ≤ 120 kB (render Markdown on the server, drop `moment`, `framer-motion`, full `highlight.js`); LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 as *targets*; verify with Lighthouse CI in the pipeline (lab) and real-user monitoring or CrUX after launch (field).

## 3. Avoid thin or low-value pages (decision rules)

Importing the upstream dataset could tempt generating thousands of pages. Do not. A listing page is **indexable** only when all hold:

* it meets the *Eligible* criteria and is not security-flagged (`submission-eligibility-criteria.md`);
* it has a human-meaningful description of ≥ 80 characters that is not a duplicate of its repository description or another listing (near-duplicate check);
* it has at least an install route (package/endpoint) *and* derived facts (language/transport/license);
* it has been seen by a reviewer or passed static inspection within the last N days.

Everything else stays reachable by direct link and search inside the site but carries `noindex` until it qualifies. Bulk submitters that file many templated entries ("No tools listed", identical boilerplate; see the dataset analysis for measured share) are the main thin-content risk; cap indexation per publisher until quality is shown. Category pages are indexed only above a minimum number of qualifying listings and with unique intro copy.

## 4. Search relevance

* **Phase 1:** PostgreSQL full-text search (`tsvector` over name, description, tags, package ids, repo owner/name) with weights, plus `pg_trgm` for typo tolerance and prefix matching; escape/parameterise input (fixes F-08); return total counts and sort by rank then recency.
* **Phase 2 (only if the evaluation below shows need):** synonym tables (e.g. "postgres"/"postgresql"), capability extraction from tool names, filters/facets.
* **Evaluation set:** a hand-labelled list of ~100 realistic queries ("postgres", "browser automation", "github issues", "slack", "filesystem") with expected top results, tracked as nDCG@10/MRR over time. Do not adopt Elasticsearch/Algolia/vector search unless this set shows Postgres FTS failing at the real catalogue size.
* **Empty states:** zero-result queries show spelling suggestions, popular categories, and a "can't find your server? Submit it" link; log zero-result queries (without personal data) as product input.

## 5. Internal linking and documentation

* Listing ↔ category ↔ language/transport facets ↔ related servers (same category + shared tags, computed offline, not random); breadcrumbs with `BreadcrumbList`.
* "How we verify", "Eligibility criteria", "Submission guide", "Install in Claude Desktop / Cursor / VS Code" evergreen pages are the pages worth ranking; keep them accurate and dated.
* Per-client config tutorials generated from the same templates as the install blocks to avoid drift.

## 6. Growth and retention levers (differentiators, not tactics for their own sake)

1. **Trust-first positioning:** visible evidence levels and dates; "claimed by owner" state; honest "not performed" labels: this is the main gap versus list-style directories.
2. **Owner loop:** badge/README snippet ("Listed on {Registry}", links to the listing) for maintainers; owner-verified entries get status notifications and edit access; a healthy submission experience is itself a growth channel.
3. **Developer utility:** copyable configs, a read-only JSON API and feed, and later a small MCP server for querying the registry (an upstream issue #11 already asks for this).
4. **Freshness:** "recently updated" and "newly listed" feeds based on real repository activity.
5. **Community feedback loop:** correction requests and removal requests handled quickly and publicly (response-time stat).

## 7. Measurement plan

Instrument with a privacy-preserving analytics tool (cookie-less where possible; no inherited third-party IDs). Events are defined without personal data.

| Metric | Definition | Why |
|---|---|---|
| Search-to-detail CTR | sessions with ≥1 result click ÷ sessions with a search | relevance proxy |
| Zero-result rate | searches with 0 results ÷ searches | coverage and synonym gaps |
| Install-block copy rate | `copy` events on install blocks ÷ detail views | utility/intent |
| Submission completion rate | submissions finished ÷ started | form friction |
| Duplicate-submission rate | submissions matching an existing canonical key ÷ submissions | dedup effectiveness, spam signal |
| Time to first decision | median/p95 from `Submitted` to first reviewer/system decision | operational health |
| Verification job completion rate / latency | completed ÷ enqueued; p50/p95 duration; stalled count | pipeline reliability |
| Evidence-level mix | listings by highest level | product quality over time |
| Returning developers | 28-day return rate (aggregate, no identifiers) | retention |
| Organic discovery of useful pages | Search Console impressions/clicks to indexable listing pages; share of landing pages that are listings with ≥ "Repository inspected" | SEO quality, not volume |
| Correction/removal turnaround | median time to resolve | trust |
| Core Web Vitals (field) | p75 LCP/INP/CLS from RUM/CrUX | performance |

All of these have **no baseline today**; the first launch milestone is to start measuring, then set targets from the first 4-8 weeks of data.
