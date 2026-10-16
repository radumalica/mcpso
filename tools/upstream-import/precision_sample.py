"""Fixed-seed sample for a MANUAL precision spot-check of the classifier (not a measured precision).
Prints stored repository facts only (no network). Usage: precision_sample.py <out_dir> <seed>"""
import json, sys, pathlib, random, collections
out = pathlib.Path(sys.argv[1]); seed = int(sys.argv[2])
rows = [json.loads(l) for l in (out / "classified/projects-classified.jsonl").read_text().splitlines()]
enr = {}
for l in (out / "enrichment/repos.jsonl").read_text().splitlines():
    e = json.loads(l); enr[e["requested_key"]] = e
random.seed(seed)
def rule(r): return r["reasons"][0]["rule"]
def pick(pop, n): return random.sample(pop, min(n, len(pop)))
i3 = [r for r in rows if rule(r) == "I3"]
elig = [r for r in rows if r["category"] == "eligible"]
bulk = [r for r in elig if "bulk_submitter" in r["quality_indicators"] or "tools_not_listed" in r["quality_indicators"]]
rest = [r for r in elig if r not in bulk]
n1 = [r for r in rows if rule(r) == "N1"]
groups = [("I3 (ALL)", i3), ("ELIGIBLE non-bulk (random 20)", pick(rest, 20)), ("ELIGIBLE bulk/template (random 20)", pick(bulk, 20)), ("N1 (random 20)", pick(n1, 20))]
print("population sizes: I3", len(i3), "| eligible", len(elig), "(bulk/template", len(bulk), ", other", len(rest), ") | N1", len(n1))
for title, sel in groups:
    print(f"\n######## {title}: n={len(sel)}")
    for r in sel:
        e = enr.get(r["canonical_key"]) or {}
        print(f"- {r['canonical_key']}  | name={str(r['name'])[:50]!r} | lang={r['repo'] and r['repo'].get('language')} stars={r['repo'] and r['repo'].get('stars')}")
        print(f"    claim-desc: {str(r['description'])[:110]!r}")
        print(f"    repo-desc: {str(e.get('description'))[:110]!r} topics={e.get('topics', [])[:5]}")
        print(f"    strong={r['evidence_strong'][:3]} weak={r['evidence_weak'][:3]} readme_mention={str(e.get('readme_mcp_mention'))[:80]!r}")
