"""Summarize pnpm/npm audit JSON + outdated JSON from reports/evidence into compact tables."""
import json, re, sys, pathlib
ev = pathlib.Path(sys.argv[1])

def load(name):
    t = (ev / name).read_text()
    body = "\n".join(l for l in t.splitlines() if not l.startswith(("$ ", "# ")))
    try:
        return json.loads(body)
    except Exception as e:
        return {"_parse_error": str(e), "_head": body[:300]}

a = load("pnpm-audit.txt")
print("pnpm audit metadata:", json.dumps(a.get("metadata", a.get("_head")), indent=None))
seen = {}
for k, adv in (a.get("advisories") or {}).items():
    paths = sorted({f["paths"][0] if f.get("paths") else "" for f in adv.get("findings", [])})
    seen[k] = (adv["severity"], adv["module_name"], adv["vulnerable_versions"], adv["patched_versions"], adv["title"][:80], adv.get("github_advisory_id"), adv.get("cves"), paths[:2])
order = {"critical": 0, "high": 1, "moderate": 2, "low": 3}
for v in sorted(seen.values(), key=lambda x: order.get(x[0], 9)):
    print(v)
print("total advisories", len(seen))

o = load("pnpm-outdated.txt")
print("\noutdated:")
if isinstance(o, dict):
    for name, d in o.items():
        if name.startswith("_"):
            print(o); break
        print(f"{name}: current={d.get('current')} wanted={d.get('wanted')} latest={d.get('latest')} dev={d.get('isDeprecated')} deprecated={d.get('isDeprecated')}")
