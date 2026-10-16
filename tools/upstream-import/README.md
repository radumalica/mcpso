# Upstream submission importer

Reproducible pipeline that recovers MCP server submissions from the upstream GitHub repository
(`chatmcp/mcpso`, formerly `chatmcp/mcp-directory`), normalises them, de-duplicates by canonical
identity, enriches with repository facts, and classifies eligibility with deterministic rules.

* Zero dependencies; Node ≥ 20 (developed on Node 24), ESM `.mjs` (same runtime as the app; no build step).
* **Never executes, installs, or fetches imported content.** Network use is limited to `api.github.com` (REST + GraphQL) and `registry.modelcontextprotocol.io` (read-only listing).
* No token is stored or logged. Provide one with `GITHUB_TOKEN`, or pass `--use-gh-token` to read it from `gh auth token`. Unauthenticated runs work for the REST stages (60 req/h; slow) but **enrichment requires a token** (GraphQL).

## Run (full pipeline)

```bash
export GITHUB_TOKEN=...            # or add --use-gh-token to the commands that need it
OUT=data/upstream-import

node tools/upstream-import/collect.mjs           --out $OUT --use-gh-token   # 1. raw records (resumable)
node tools/upstream-import/normalize.mjs         --out $OUT                  # 2. structured claims
node tools/upstream-import/dedup.mjs             --out $OUT                  # 3a. pre-enrichment projects
node tools/upstream-import/enrich.mjs            --out $OUT --use-gh-token   # 4a. GitHub facts + MCP evidence (resumable)
node tools/upstream-import/registry-snapshot.mjs --out $OUT                  # 4b. official MCP registry snapshot
node tools/upstream-import/dedup.mjs             --out $OUT --enrichment $OUT/enrichment/repos.jsonl   # 3b. merge renames
node tools/upstream-import/classify.mjs          --out $OUT                  # 5. classification + CSV/JSONL outputs
node tools/upstream-import/approval_lanes.mjs     --out $OUT                  # 6. approval lanes (who may be approved how; approves nothing)
node tools/upstream-import/reconcile.mjs         --out $OUT                  # 7. reconciliation report (exits non-zero if counts do not add up)
```

Tests: `node --test tools/upstream-import/test/*.test.mjs`

Incremental refresh: `collect.mjs --incremental` re-lists only issues/comments updated since the last completed run's watermark and upserts them; then re-run steps 2-5 (`enrich.mjs` skips repos already resolved; add `--refresh` to redo all).
Interrupted runs resume from `<out>/state/collect.json` (next page URL per stage) and from the already-written JSONL (records are keyed; duplicates collapse on compaction).

## Output layout (`<out>/`)

| Path | Content |
|---|---|
| `raw/issues.jsonl`, `raw/pull_requests.jsonl`, `raw/issue_comments.jsonl`, `raw/pull_files.jsonl`, `raw/errors.jsonl` | Source records exactly as collected (flattened API fields; original title/body untouched). **Untrusted text.** |
| `collect-manifest.json`, `state/collect.json`, `logs/*.log` | Counts, checkpoints, structured JSONL logs (tokens redacted) |
| `normalized/normalized.jsonl` / `.csv`, `normalize-summary.json` | One record per source record with extracted claims, intent, flags |
| `dedup/projects.jsonl`, `dedup-summary.json` | Canonical projects with all source references and merge reasons |
| `enrichment/repos.jsonl`, `enrichment/official-registry.jsonl` | GitHub facts + static MCP evidence; official registry snapshot |
| `classified/*` | Final classification, CSV reports, review/security/unretrievable lists, `classification-summary.json` |

Raw JSONL is large (~10 MB) and is **not** meant for source control (see `data/upstream-import/.gitignore`); regenerate it with the commands above. Small derived outputs and summaries are committed.

## Rules and their documentation

* Eligibility rules: `reports/submission-eligibility-criteria.md` (implemented literally in `classify.mjs`; rule IDs appear in every result).
* Method, limitations: `reports/submission-import-methodology.md`. Results: `reports/submission-dataset-analysis.md`.
