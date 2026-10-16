"""Overlaps between categories, flags and holds at project level (local artifacts only).
Usage: python3 -I tools/upstream-import/count_overlaps.py data/upstream-import"""
import json, sys, pathlib, collections
out = pathlib.Path(sys.argv[1])
rows = [json.loads(l) for l in (out / "classified/projects-classified.jsonl").read_text().splitlines()]
C = collections.Counter
print("projects:", len(rows), "| categories:", dict(C(r["category"] for r in rows)))
BLOCK = {"same_repo_incompatible_names", "multiple_keys_merged", "shared_package_across_repos", "shared_endpoint_across_repos"}
amb = [r for r in rows if set(r["ambiguity_flags"]) - {"monorepo_subpath_project"}]
print("ambiguous (excl. monorepo_subpath):", len(amb), "by category:", dict(C(r["category"] for r in amb)))
n6 = [r for r in rows if any(x["rule"] == "N6" for x in r["reasons"])]
print("projects with an N6 reason:", len(n6), "by category:", dict(C(r["category"] for r in n6)), "| N6 as FIRST rule:", sum(1 for r in n6 if r["reasons"][0]["rule"] == "N6"))
print("blocking-flag projects:", sum(1 for r in rows if set(r["ambiguity_flags"]) & BLOCK), "| ambiguous but no N6:", sum(1 for r in amb if r not in n6), "| N6 but not in ambiguous:", sum(1 for r in n6 if r not in amb))
elig = [r for r in rows if r["category"] == "eligible"]
sec = [r for r in elig if r["security_concern"]]
held = [r for r in elig if "removal_request_pending" in r["quality_indicators"]]
print("eligible:", len(elig), "| security-flagged:", len(sec), "| removal-held:", len(held), "| both:", len([r for r in sec if r in held]))
ready = [r for r in rows if r["import_ready"]]
print("import_ready:", len(ready), "= eligible - flagged - held + both =", len(elig) - len(sec) - len(held) + len([r for r in sec if r in held]))
print("import_ready outside eligible:", sum(1 for r in ready if r["category"] != "eligible"))
print("ambiguity overlaps with eligible?", dict(C(r["category"] for r in amb)))
print("held (any category):", sum(1 for r in rows if "removal_request_pending" in r["quality_indicators"]), "| security-flagged (any category):", sum(1 for r in rows if r["security_concern"]))
