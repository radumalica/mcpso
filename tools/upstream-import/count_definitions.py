"""Record-level audit of how the 6,052 identity-bearing submission records became 4,868 projects.
Reads local artifacts only (normalized.jsonl, dedup/projects.jsonl).
Usage: python3 -I tools/upstream-import/count_definitions.py data/upstream-import
Prints counts with their counting unit (records vs projects vs repositories)."""
import json, sys, pathlib, collections
out = pathlib.Path(sys.argv[1])
rd = lambda p: [json.loads(l) for l in (out / p).read_text().splitlines()]
recs = {r["record_id"]: r for r in rd("normalized/normalized.jsonl")}
projs = rd("dedup/projects.jsonl")
C = collections.Counter
ids = [i for p in projs for i in p["source_record_ids"]]
print("records placed in projects:", len(ids), "distinct:", len(set(ids)))
print("projects:", len(projs), "| sum(source_count - 1) =", sum(p["source_count"] - 1 for p in projs))
multi = [p for p in projs if p["source_count"] > 1]
print("multi-record projects:", len(multi), "| records inside them:", sum(p["source_count"] for p in multi))
mr = C(); mr_rec = collections.defaultdict(set)
for p in projs:
    for m in p["merge_reasons"]:
        mr[m["rule"]] += 1
        if "record_id" in m: mr_rec[m["rule"]].add(m["record_id"])
print("merge_reasons entries by rule:", dict(mr))
print(" per-record entries (distinct records):", {k: len(v) for k, v in mr_rec.items()})
print(" multi-record projects by identity_type:", dict(C(p["identity_type"] for p in multi)))
basis = C()
for p in multi:
    for rid in p["source_record_ids"][1:]:
        rules = {m["rule"] for m in p["merge_reasons"] if m.get("record_id") == rid}
        basis["linked_by_" + "+".join(sorted(rules)) if rules else "same_key_as_group"] += 1
print("duplicate (non-first) records by basis:", dict(basis), "total", sum(basis.values()))
r6_proj = [p for p in projs if any(m["rule"] == "R6" for m in p["merge_reasons"])]
r6_multi = [p for p in r6_proj if p["source_count"] > 1]
print("R6: records re-keyed:", len(mr_rec.get("R6", set())), "| projects containing them:", len(r6_proj), "| of which multi-record:", len(r6_multi))
joined = 0
for p in r6_multi:
    keys = {recs[i]["claims"].get("repo_key") for i in p["source_record_ids"] if recs[i]["claims"].get("repo_key")}
    if len(keys) > 1:
        joined += 1
print("multi-record projects whose records carried different ORIGINAL repo keys (a rename joined them):", joined)
amb = C(); n = 0; n2 = 0
for p in projs:
    codes = {f["code"] for f in p["ambiguity_flags"]}
    amb.update(codes)
    rest = codes - {"monorepo_subpath_project"}
    n += bool(rest); n2 += len(rest) > 1
print("projects with a review-relevant ambiguity flag (excl. monorepo_subpath):", n, "| with >1 such flag:", n2, "| flag counts (projects):", dict(amb))
sub = [r for r in recs.values() if r["intent"] in ("submission", "submission_unclear")]
print("submission-type records:", len(sub), "| placed in projects:", len(set(ids)), "| not placed:", len(sub) - len(set(ids)))
