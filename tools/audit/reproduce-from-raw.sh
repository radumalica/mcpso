#!/usr/bin/env bash
# Re-run normalise -> dedup -> classify -> reconcile from the stored RAW snapshot (no network) into a scratch directory
# and compare against the stored results. Usage: tools/audit/reproduce-from-raw.sh <stored_out> <scratch_dir>
set -euo pipefail
SRC="$1"; DST="$2"
rm -rf "$DST"; mkdir -p "$DST/enrichment"
cp -a "$SRC/raw" "$DST/raw"
cp "$SRC/collect-manifest.json" "$DST/"
cp "$SRC/enrichment/repos.jsonl" "$SRC/enrichment/official-registry.jsonl" "$DST/enrichment/"
# the registry completeness line is read from logs/registry-*.log
mkdir -p "$DST/logs"; cp "$SRC"/logs/registry-*.log "$DST/logs/" 2>/dev/null || true
node tools/upstream-import/normalize.mjs --out "$DST" >/dev/null 2>&1
node tools/upstream-import/dedup.mjs --out "$DST" --enrichment "$DST/enrichment/repos.jsonl" >/dev/null 2>&1
node tools/upstream-import/classify.mjs --out "$DST" >/dev/null 2>&1
node tools/upstream-import/approval_lanes.mjs --out "$DST" >/dev/null
node tools/upstream-import/reconcile.mjs --out "$DST" >/dev/null
python3 -I - "$SRC" "$DST" <<'PY'
import json, sys, hashlib, pathlib
src, dst = map(pathlib.Path, sys.argv[1:3])
VOLATILE = {"generated_at", "finished_at"}
def strip(o):
    if isinstance(o, dict): return {k: strip(v) for k, v in o.items() if k not in VOLATILE}
    if isinstance(o, list): return [strip(v) for v in o]
    return o
bad = 0
for rel in ["normalized/normalize-summary.json", "dedup/dedup-summary.json", "classified/classification-summary.json", "classified/approval-lanes-summary.json", "reconciliation.json"]:
    a, b = strip(json.loads((src / rel).read_text())), strip(json.loads((dst / rel).read_text()))
    same = a == b
    bad += not same
    print(("IDENTICAL " if same else "DIFFERS   ") + rel)
def rowset(p):
    return sorted(json.dumps({k: v for k, v in json.loads(l).items()}, sort_keys=True) for l in p.read_text().splitlines())
for rel in ["dedup/projects.jsonl", "classified/projects-classified.jsonl", "normalized/normalized.jsonl"]:
    same = rowset(src / rel) == rowset(dst / rel)
    bad += not same
    print(("IDENTICAL " if same else "DIFFERS   ") + rel)
sys.exit(1 if bad else 0)
PY
