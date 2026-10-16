# Rebranding Proposal: independent, free-to-submit MCP server registry

> **Scope update (master plan v5):** the product is an independently operated registry built by enhancing this codebase; the historical upstream addition requests are imported, deduplicated, evaluated and selectively published (R07), with its own brand, infrastructure and data model, and without upstream branding or runtime dependence. Importing, eligibility and approval are separate concepts; the MVP scope is reduced. See `master-plan-v5.md`, `mvp-feature-matrix.md` and `publication-gate-checklist.md`.

Status: proposal only. No repository branding, package names, logos or config were changed. Nothing here reuses the name, logo or assets of mcp.so.
Checks run: 2026-10-16, about 10:00-10:10 UTC, from a single Linux host (DNS via system resolver, RDAP and APIs over HTTPS).

## 1. Ground rules

- Avoid "mcp.so", "Anthropic", "Claude" and "Model Context Protocol" as name elements. "MCP" as a descriptive acronym is acceptable but is not used in any finalist.
- Avoid names confusable with the official MCP Registry (registry.modelcontextprotocol.io) or existing directories: Smithery, Glama, PulseMCP, mcp.so, mcpservers.org, Docker MCP Catalog, and similar ("MCP Hub", "MCP Market", "MCP Registry", "Registry" alone).
- Single common English words are all registered across .com/.dev/.org/.io (see section 4), so candidates are coined compounds or rare words.

## 2. Candidates

| # | Name | Idea |
|---|------|------|
| 1 | Portolan | Medieval sailing chart; maps of known harbours |
| 2 | Lodestar | Guiding star for navigation |
| 3 | Tessera | Mosaic tile; a piece in a larger whole |
| 4 | Cairn | Stacked-stone trail marker |
| 5 | Wayfinder | Navigation / discovery |
| 6 | Beaconry | Coined from "beacon"; signals where servers are |
| 7 | Cairnbase | Cairn + base (data store / base camp) |
| 8 | Lodehaven | Lode (ore vein, also "lodestar") + haven; a place where valuable servers are found |
| 9 | Cairnindex | Cairn + index; directly states function |
| 10 | Tesselhub | Tessera-like + hub |

Also tried and dropped: Sextant, Almanac, Tollbooth (all taken everywhere, see raw results), Toolharbor, Cartulary, Wayhouse, Portolano, Mcpharbor (the last contains "mcp" and is registered on three of four TLDs), Wayledger (an existing iPhone app and a registered .com/.io).

## 3. Scoring (subjective, author judgment, 1 = poor, 5 = strong)

Scores are opinions to structure discussion, not measurements. "Conflicts" and "Domains" scores are derived from the section 4 evidence; higher = fewer observed conflicts.

| Name | Memorable | Pronounce | MCP relevance | OSS dev tool fit | Registry growth | Conflicts | Domains | Total /35 |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Portolan | 4 | 3 | 4 | 4 | 4 | 1 | 1 | 21 |
| Lodestar | 4 | 5 | 3 | 4 | 4 | 1 | 1 | 22 |
| Tessera | 3 | 4 | 2 | 3 | 3 | 1 | 1 | 17 |
| Cairn | 5 | 5 | 4 | 5 | 4 | 1 | 1 | 25 |
| Wayfinder | 4 | 5 | 4 | 3 | 4 | 1 | 1 | 22 |
| Beaconry | 3 | 4 | 3 | 3 | 3 | 3 | 2 | 21 |
| Cairnbase | 4 | 5 | 3 | 4 | 5 | 3 | 4 | 28 |
| Lodehaven | 3 | 4 | 3 | 3 | 4 | 4 | 4 | 25 |
| Cairnindex | 3 | 4 | 4 | 3 | 3 | 4 | 5 | 26 |
| Tesselhub | 2 | 3 | 2 | 3 | 3 | 3 | 4 | 20 |

Justifications (brief):
- Cairn scores highest on brand quality (trail markers = discovery, short, easy) but every domain and the GitHub, npm and PyPI names are taken and at least one MCP server already uses it (jasondostal/cairn-mcp, 7 stars, per `gh search repos`). Not viable as a bare name.
- Cairnbase / Cairnindex keep the cairn metaphor while being distinctive. Residual risk: confusion with cairn-mcp projects and the Cairn org on GitHub; needs legal review.
- Lodehaven is distinctive and unclaimed on the platforms checked, but is a less obvious word and its .com is registered.
- Lodestar, Wayfinder, Portolan, Tessera are strong words but are saturated (domains, orgs, packages) and Tessera and Lodestar already have MCP-named repos.

## 4. Raw check results (2026-10-16 ~10:00-10:10 UTC)

Methods:
- DNS: `dig +short NS <domain> | head -1` (NS shown, "none" = empty answer).
- RDAP: HTTP status from the registry endpoint: .com `rdap.verisign.com/com/v1/domain/`, .dev `pubapi.registry.google/rdap/domain/`, .org `rdap.publicinterestregistry.org/rdap/domain/`, .io `rdap.identitydigital.services/rdap/domain/`. 200 = registration record exists (TAKEN). 404 = "no registration record found; availability not confirmed".
- GitHub: `gh api users/<name>` (covers users and orgs; reports account type, or Not Found = no account with that login at check time).
- npm: `curl https://registry.npmjs.org/<name>`; PyPI: `curl https://pypi.org/pypi/<name>/json`. 200 = package with that exact name exists; 404 = none.
- Repos: `gh search repos "<name>"` and `"<name> mcp"`, top 3-4 by relevance.

Legend: T = registered (RDAP 200); "-" = no registration record found, availability not confirmed.

| Name | .com | .dev | .org | .io | GitHub login | npm | PyPI |
|------|:--:|:--:|:--:|:--:|------|:--:|:--:|
| portolan | T | T | T | T | User exists | 200 | 200 |
| lodestar | T | T | T | T | Org exists | 200 | 200 |
| tessera | T | T | T | T | Org exists | 200 | 200 |
| cairn | T | T | T | T | Org exists | 200 | 200 |
| sextant | T | T | T | T | User exists | 200 | 200 |
| wayfinder | T | T | T | T | Org exists | 200 | 200 |
| almanac | T | T (no NS) | T | T | User exists | 200 | 200 |
| tollbooth | T | T (no NS) | T | - | User exists | 200 | 200 |
| toolharbor | T | T | T | - | Org exists | 404 | 200 |
| beaconry | T | T | T | - | Org exists | 404 | 404 |
| cartulary | T | T | T | T | Org exists | 200 | 200 |
| wayhouse | T | T | T | T | User exists | 404 | 404 |
| portolano | T | T | T | - | User exists | 404 | 200 |
| mcpharbor | T | T | - | T | none (404) | 404 | 404 |
| **cairnbase** | T | - | - | - | none (404) | 404 | 404 |
| **lodehaven** | T | - | - | - | none (404) | 404 | 404 |
| **cairnindex** | - | - | - | - | none (404) | 404 | 404 |
| lodecairn | - | - | - | - | none (404) | 404 | 404 |
| wayledger | T | - | - | T | none (404) | 404 | 404 |
| tesselhub | T | - | - | - | none (404) | 404 | 404 |

Repo and MCP-confusability searches (`gh search repos`, stars in parentheses):
- "lodestar mcp": kanlanc/lodestar-mcp (0), chasepkelly/lodestar-mcp-server (0).
- "tessera mcp": usetessera/tessera-mcp (0); other hits were unrelated (Tesseract).
- "cairn mcp": jasondostal/cairn-mcp (7), lekman/cairn-mcp (0), Appwood/cairn-mcp (0).
- "wayfinder mcp": Atrius-Wayfinder/wayfinder-mcp-sample (0).
- "portolan mcp", "beaconry mcp", "harbor mcp registry": no results. "beaconry": two unrelated 0-star repos (school broadcast app).
- "cairnbase", "lodehaven", "cairnindex", "tesselhub": no repositories found.
- wayledger: existing iPhone mileage-tracker / RV planning app pages (0 stars).

Limitations: WebSearch was not used; the web (non-GitHub) landscape (companies, products, app stores) is NOT checked for any name. Only exact-string names were checked; variants (hyphenated, plural, other TLDs such as .ai/.app/.net) were not. A GitHub 404 only means no account with that login at check time; names can be claimed at any moment.

## 5. Finalists and trade-offs

All three are tentative. None is confirmed available; none has had a trademark search.

1. **Cairnbase**
   - For: memorable metaphor (trail marker, base camp), easy to say and spell, "base" suggests a durable registry and wider product; GitHub login, npm, PyPI unclaimed; .dev/.org/.io showed no registration record.
   - Against: cairnbase.com is registered (owner/intent unknown, would need purchase or an alternative); proximity to the many "Cairn" projects including cairn-mcp (7 stars) raises confusion and opposition risk; "-base" suffix is common in dev tools.
2. **Lodehaven**
   - For: most distinctive, no GitHub repos, no MCP namesakes found; GitHub, npm, PyPI unclaimed; .dev/.org/.io no registration record; "haven" fits a trusted, free registry.
   - Against: lodehaven.com is registered; less intuitive spelling ("lode" vs "load"), weaker link to discovery; longer to type.
3. **Cairnindex**
   - For: all four domains showed no registration record, plus GitHub, npm and PyPI unclaimed; name states function (index of servers); most complete namespace.
   - Against: lowest brand flair; "index" is descriptive and so a weaker trademark; same Cairn proximity risk as Cairnbase. The wide-open namespace may also mean domain premium pricing or registry restrictions, which RDAP cannot show.

Suggested order: Cairnbase if cairnbase.com can be acquired at a reasonable price or the product is happy on .dev; otherwise Lodehaven; Cairnindex as the safe namespace fallback.

## 6. Visual identity guidance (principles only, no logos)

- Create everything from scratch; do not copy, trace or recolor mcp.so's logo, favicon, illustrations or wordmark. Remove inherited assets from the fork before launch.
- Pick a single simple geometric motif tied to the final name (e.g. stacked forms for Cairn names, a faceted shape for Lodehaven). It should work at 16 px, in one colour, on light and dark backgrounds.
- Do not use the MCP protocol logo, Anthropic or Claude marks, or imagery implying official endorsement. Include a "not affiliated with the Model Context Protocol project or Anthropic" line in the footer and README.
- Palette: restrained, 1 primary + 1 accent + neutrals; verify WCAG AA contrast (4.5:1 body text) in both light and dark themes.
- Typography: open-licensed typefaces only (e.g. SIL OFL), with licence files tracked in the repo.
- Voice: plain, technical, free-to-submit and open-source stated up front; avoid superlatives.
- Deliverables: wordmark, symbol, favicon set, social/OG card, simple usage guidelines, all under a documented licence (e.g. CC BY or the project licence) with the designer's contribution agreement.
- Check any commissioned or generated artwork for originality and licence provenance (reverse image search, asset licence records).

## 7. Follow-ups required before adopting any name

1. **Trademark search NOT performed for any candidate.** Search before adoption: USPTO Trademark Search (trademarks.search.uspto.gov, replaced TESS), EUIPO TMview, WIPO Global Brand Database, plus UKIPO and any key local registers. Classes: 9 (software), 42 (SaaS / hosting / software development), 35 (directory and listing services). Search identical, phonetic (Cairn/Kern/Cairne) and conceptual variants, and "Cairn" and "Lode" families. Obtain advice from a trademark attorney.
2. Common-law and web search: company names, app stores, package registries beyond npm/PyPI (crates.io, Docker Hub, Homebrew), Hugging Face, social platforms. Not performed.
3. Domains: confirm with a registrar (RDAP 404 is not proof of availability: premium, reserved or restricted names are possible). Attempt purchase of the chosen .com/.dev/.org; for registered .coms, look up the registrant/WHOIS contact, check for a live site, and consider an offer or escrow.
4. GitHub: reserve the org login and a placeholder repo; also npm scope and PyPI project name; re-check immediately before use because 404s expire.
5. Social handles (X, Bluesky, Mastodon, LinkedIn, YouTube, Discord, Reddit): not checked; check and reserve.
6. Re-run the section 4 checks on the day of decision and record the results.
7. Decide on a legal entity or fiscal host for ownership of the name and domains; license and contribution policy for the brand assets.
8. Confirm with the MCP registry maintainers and review directory names (Smithery, Glama, PulseMCP, mcp.so, mcpservers.org, Docker MCP Catalog) for fresh conflicts at the time of launch.
9. Only after the above, plan a rename PR (package names, UI strings, domains, redirects, SEO). Not part of this proposal.
