#!/usr/bin/env bash
# Dry-run classification on a scratch copy of the current data (never writes into the real out dir).
SRC=/home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit/data/upstream-import
DST=/home/ubuntu/.claude/jobs/00ec914d/tmp/dry
rm -rf "$DST"; mkdir -p "$DST/enrichment" "$DST/dedup" "$DST/normalized"
cp "$SRC/collect-manifest.json" "$DST/"
cp "$SRC/normalized/normalized.jsonl" "$DST/normalized/"
cp "$SRC/dedup/projects.jsonl" "$DST/dedup/"
cp "$SRC/enrichment/repos.jsonl" "$DST/enrichment/"
[ -f "$SRC/enrichment/official-registry.jsonl" ] && cp "$SRC/enrichment/official-registry.jsonl" "$DST/enrichment/"
node /home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit/tools/upstream-import/classify.mjs --out "$DST" 2>&1 | head -120
