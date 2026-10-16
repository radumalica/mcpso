# UI/UX Audit

## How this review was performed (and its limits)

* **Source review:** every component under `templates/tailspark/landing/`, `app/`, `components/`.
* **Rendered review:** the app was run in dev mode against a **synthetic fixture backend** (40 fake servers, 6 categories; `tools/audit/ui-review.sh`) and captured with headless Chromium (`chromium-1248`) at 1280 px and 390 px widths. Screenshots and HTML are in `reports/evidence/ui/`. **Everything visual below describes the fixture rendering of the real components; real content (long descriptions, missing avatars, 5,000 entries) may differ.**
* **Not done:** no real-device testing, no screen-reader session (assistive-technology findings are from the DOM and source), no Lighthouse/Core Web Vitals field data (no public deployment was measured; lab sizes come from a patched local build), no usability test with users.
* Contrast ratios were computed from the Tailwind colour values in the source (`tools/audit/html_facts.py`).

## 1. Summary

The current UI is a generic landing-page template (hero, FAQ, masonry of cards) wrapped around a database table. It contains **no information a developer needs to decide whether to install a server** (no install instructions, transport, language, license, last-updated, source link on the card, or verification state), and it **displays fabricated trust signals**: every card and detail page shows five filled stars that are hard-coded and not backed by any data (`templates/.../stars/index.tsx` renders 5 icons unconditionally; `{true && <Stars />}` in `projects/item.tsx:38`).

## 2. Findings

| ID | Area | Finding | Sev. | Evidence |
|---|---|---|---|---|
| U-01 | Trust | **Fake 5-star rating on every card and detail page**, with no rating system behind it. Directly contradicts the product principle of transparent verification. | High | `stars/index.tsx`, `projects/item.tsx:38`, `home.png`, `server-mobile.png` |
| U-02 | Search | Search is a bare input ("keyword to search") with a decorative return-arrow SVG that is clickable but not focusable; no label, no `role="search"`, no filters, no sort, no result count, no highlighting, no empty state. After a search the field is disabled (see Q-02). | High | `search/index.tsx`, `html-facts.txt` (`<label`: 0, `aria-label`: 0) |
| U-03 | Navigation (mobile) | The nav list is `hidden md:block` and the mobile `DropDown` is commented out, so **on phones there is no navigation at all** (no Categories, no Submit). | High | `header/index.tsx:33`, `home-mobile.png` |
| U-04 | Submission | "Submit" is an external link to a GitHub issue thread; there is no form, no required-field guidance, no validation, no duplicate check, no status feedback. The submitter cannot learn whether the entry was accepted or why not. | High | `pagejson/en.json:17-21` |
| U-05 | Listing cards | Cards show title, author, 3-line description, fake stars, "x months ago" (derived from `created_at`, i.e. when it was *submitted to the directory*, not when the project was updated). No category, no language, no transport, no license, no repository host. Cards have variable heights in a CSS multi-column layout, so reading order runs *down columns*, which scrambles chronological/ranking order. | High | `projects/item.tsx`, `projects/index.tsx:17`, `home.png` |
| U-06 | Detail page | Lacks the essentials: **no install/config snippet, no copy button, no transport/runtime/auth/license, no tools list, no last-updated or maintenance info, no verification status, no docs link**. The only action is "Visit {title} 👉". Tags are rendered as checked, read-only checkboxes (a form control used as decoration). "Created at {updated_at}" mislabels the field. | High | `project/index.tsx:30-86`, `server.png` |
| U-07 | Soft 404 | Unknown server/category: HTTP **200**, bare `<div>Project not found</div>` with no layout; `<title>` is `- | MCP Servers`, canonical points at the non-existent URL, no `noindex`. | High | `fetch-summary.txt`, `html-facts.txt` (`[server-missing]`) |
| U-08 | Content depth | Home shows at most 100 featured items, category 300; no pagination, so most of a large catalogue is unreachable by browsing. Categories page repeats a "Featured" grid of 60 items with duplicates of the home page. | High | `app/(default)/page.tsx`, `categories/page.tsx` |
| U-09 | Accessibility: images | **201 of 205 `<img>` on the home page have `alt="star"`**, so a screen reader announces "star" five times per card (200 times on the 40-card fixture page; 500 on a real home page with the default 100 cards). | High | `html-facts.txt` |
| U-10 | Accessibility: zoom | The viewport meta sets `maximum-scale=1, user-scalable=no`, blocking pinch-zoom (WCAG 1.4.4 failure). | High | `app/layout.tsx:25` |
| U-11 | Accessibility: semantics | Card titles are `<p>`, not headings; FAQ toggles are `<button>`s without `aria-expanded`/`aria-controls`; breadcrumb current item has `aria-current` on all items; the search icon is not a button; no skip link. | Medium | source |
| U-12 | Accessibility: contrast | Detail-page description uses `#808080` on white = **3.95:1** (fails AA 4.5:1 for normal text); placeholder grey (slate-400) 2.56:1. Card body `#636262` passes (6.08:1). | Medium | `html_facts.py` output |
| U-13 | Responsive | Layout reflows acceptably at 390 px (single column, readable hero); the 5-star row and hero blobs are decorative but harmless. The star-count GitHub button is `hidden md:flex`. Long title wraps correctly. | Info | `home-mobile.png`, `server-mobile.png` |
| U-14 | Loading / error / empty states | No `loading.tsx`, no skeletons, no `error.tsx`/`not-found.tsx`; a failing database renders an empty grid and "0 MCP Servers Stored". An empty search returns an empty page with no message. | Medium | source; Q-07 |
| U-15 | Forms & validation | The only form is the search box (`<form method="POST" action="/gpts/search">`, a route that does not exist; Enter is intercepted in JS so it works only with scripting enabled). | Medium | `search/index.tsx:56-60` |
| U-16 | SEO / metadata | No Open Graph or Twitter tags, no JSON-LD, generic descriptions ("Find Awesome MCP Server {title}: {description}"), identical home description used on the privacy page, canonical URLs are built from `NEXT_PUBLIC_WEB_URL` and become the literal string `undefined/...` if it is unset, `robots.txt` has no `Sitemap:` line and disallows `/privacy-policy/` (trailing slash does not match `/privacy-policy`), sitemaps are static and list `mcp.so` URLs. | Medium | `html-facts.txt`, `public/*` |
| U-17 | Performance | First-load JS: home 175 kB, **detail 481 kB**, legal pages 446 kB (client-side Markdown + full highlight.js); every page fetches live from the DB with no caching; avatars are lazy-loaded via a library plus a 566 KB `preview.png` in the repo root (README only). | Medium | `build-patched-copy.txt` |
| U-18 | Visual design | Template defaults: heavy blue (#2752f4-ish) display type, large hero, decorative star sparkles, thick black dividers, inconsistent spacing; tag/category chips in different styles on different pages; "MCP Servers" brand is generic text + `mcp.so`-derived logo (must be replaced). Typography is Geist (loaded locally: good) but hierarchy relies on size only. | Low | screenshots |
| U-19 | Trust & identity | Footer/FAQ/policies carry the upstream brand (`mcp.so`, `support@mcp.so`), upstream "Friends" links to sibling commercial products, and upstream community links (Telegram/Discord). A fork must not present these as its own. | High | `pagejson/en.json` |
| U-20 | Client behaviour | The hero GitHub button polls GitHub every 6 s (A-08); the FAQ uses `framer-motion` for a simple accordion. | Low | source |

## 3. What works and should be kept

* Local fonts (no layout shift from font CDN), `lang="en"`, a single `<h1>` per page, per-page `<title>` and canonical on listing pages, breadcrumbs on detail pages, responsive single-column fallback, safe Markdown rendering (verified).
* Category taxonomy exists (24 categories in the summarisation prompt, `services/prompts/summarize_project.ts:11`), a reasonable starting vocabulary.

## 4. Proposed information design (details in `product-requirements.md`)

**Card (list item):** name, one-line description, repository owner/name, language, transport chips (`stdio` / `streamable-http` / `sse`), hosting (local / remote), license, "updated 3 d ago" (last repository push), and **one** verification line that states the highest evidence level actually achieved, e.g. "Metadata validated · Repository inspected" (never a star rating).

**Detail page:** summary; **copyable install/config block per client** (when derivable from the package manifest); source & docs links; tools list *as extracted*, labelled by source; evidence panel (see §5); maintenance panel (last push, archived, open issues if fetched, release date); security panel (dependency advisories found *from lockfiles*, install-script flags); provenance (submission(s), submitter, date); "report a problem / suggest a correction".

## 5. Verification vocabulary for the UI (must never be conflated)

| Level (display name) | Meaning | Shown only if |
|---|---|---|
| **Metadata validated** | Submission fields parsed and schema-valid; canonical identity resolved | always computed |
| **Repository inspected** | Repo exists, public, license/activity read, MCP SDK or `server.json` evidence found statically | the static inspection ran, with date and commit |
| **Build passed** | Dependencies installed and project built in a sandbox | the opt-in sandbox build ran and passed |
| **MCP protocol test passed** | `initialize` + `tools/list` succeeded in a sandbox or against a probed endpoint | the protocol test ran and passed |
| **Remote endpoint reachable** | HTTPS endpoint answered the probe (ownership verified) | the prober ran |
| **Security checks performed** | Lists *which* checks (e.g. lockfile advisories, secret scan), with findings | each check named individually |

A listing with only the first level must look visibly different from one with all six; a missing level is shown as "not performed", not hidden.

## 6. Prioritised redesign plan

1. **Immediately (low effort, before any public relaunch):** remove fake stars (U-01), fix mobile navigation (U-03), remove inherited branding (U-19), allow zoom (U-10), real 404s (U-07), fix search disabling (Q-02), `alt=""` for decorative images (U-09).
2. **Core experience (structural):** new data-backed list and detail pages with filters, pagination and a server-rendered Markdown pipeline (U-02, U-05, U-06, U-08, U-17); submission form with duplicate detection and status page (U-04).
3. **Trust layer:** evidence panels and verification vocabulary (§5) once the data model exists.
4. **Polish:** metadata/OG/JSON-LD (U-16), visual identity from the rebranding work (U-18), accessibility pass with a screen reader and automated checks (axe) in CI (U-11, U-12, U-15).
