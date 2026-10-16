# Classifier precision spot check (small sample, NOT a measured precision)

Fixed seed `20261016`, `python3 -I tools/upstream-import/precision_sample.py data/upstream-import 20261016`.
Judged by one reviewer (Claude) from the *stored facts only* (repo description, topics, README mention, evidence list); no repository code was fetched or executed.
n is tiny; the counts below must not be extrapolated to the 4,868-project population.

| Stratum (population) | n | Result |
|---|---|---|
| Ineligible rule I3 "no MCP signal" (11, all reviewed) | 11 | 7 clearly not an MCP server (Windows UI-automation tool, font skill, protocol RFC, comment about another project, budget proxy, self-declared "not an MCP submission", withdrawn desktop app); 4 uncertain (AgentReady, Proven, BuyWhere SDK, base-ops) where the stored facts show no MCP evidence but the claim says otherwise. None judged clearly wrong. |
| Eligible, not bulk/template (3,094) | 20 | 17 plainly MCP servers; 3 rest on official-registry evidence alone with a thin or non-server repo (gondola_api, standoutmcp.io endpoint, qfactory-skill). 0 clearly wrong. |
| Eligible, bulk/template submitter (408) | 20 | 12 plainly MCP servers; 6 are CLIs/libraries whose README has an "MCP Server" section and a registry entry (MCP is a secondary feature); 2 are docs/frontend repos whose registry entry points elsewhere (gemini-upgrade-qa-mcp, worldcitisim-frontend). 0 clearly non-MCP. |
| needs_review N1 "weak signals only" (357) | 20 | 12 look like genuine MCP servers (conservative classification, i.e. likely false "needs review"); 2 are scanners *about* MCP, not servers; 6 ambiguous (CLI/app/template/gateway with an MCP side feature). |

Take-aways: (1) "eligible" held up as "plausibly an MCP server" in 40 of 40 sampled; the weakness is *kind* (secondary-feature or docs-only repos) and registry-only evidence, not false positives of "not MCP". (2) N1 is deliberately conservative and about 3/5 of the sample would pass a quick human look, so the needs_review queue is a review workload, not a rejection list. (3) Eligibility is not verification, security review or quality endorsement.
