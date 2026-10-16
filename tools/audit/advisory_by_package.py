"""Aggregate pnpm audit JSON by package: severity counts, highest patched version, direct/transitive, dev/prod."""
import json, sys, pathlib, collections, re
ev = pathlib.Path(sys.argv[1])
t = (ev / "pnpm-audit.txt").read_text()
d = json.loads("\n".join(l for l in t.splitlines() if not l.startswith(("$ ", "# "))))
pkg = json.loads(pathlib.Path(sys.argv[2]).read_text())
direct = set(pkg["dependencies"]) | set(pkg["devDependencies"])
devdirect = set(pkg["devDependencies"])
order = ["critical", "high", "moderate", "low"]
agg = collections.defaultdict(lambda: {"sev": collections.Counter(), "patched": [], "paths": set(), "ids": []})
def vkey(v):
    return [int(x) if x.isdigit() else 0 for x in re.findall(r"\d+", v)]
for adv in d["advisories"].values():
    a = agg[adv["module_name"]]
    a["sev"][adv["severity"]] += 1
    m = re.search(r">=\s*([\d.]+(?:-[\w.]+)?)", adv.get("patched_versions") or "")
    if m: a["patched"].append(m.group(1))
    a["ids"].append(adv.get("github_advisory_id"))
    for f in adv.get("findings", []):
        for p in f.get("paths", []):
            a["paths"].add(p.split(">")[1] if p.startswith(".>") else p)
rows = []
for name, a in agg.items():
    top = next((s for s in order if a["sev"][s]), "low")
    roots = sorted({p for p in a["paths"]})
    rows.append((order.index(top), name, dict(a["sev"]), max(a["patched"], key=vkey) if a["patched"] else "?", name in direct, sorted(roots)[:4], len(a["ids"])))
rows.sort()
print(f"{'package':32} {'top':9} {'adv':>3}  counts                         min-fixed-version  direct  via")
for r in rows:
    print(f"{r[1]:32} {order[r[0]]:9} {r[6]:>3}  {str(r[2]):30} {r[3]:18} {str(r[4]):6}  {','.join(r[5])[:70]}")
print("\nmetadata:", d["metadata"])
vercel_only = [r for r in rows if r[5] and all(p == "vercel" for p in r[5]) and not r[4]]
print("packages whose ONLY path is via the 'vercel' dev dependency:", [r[1] for r in vercel_only])
