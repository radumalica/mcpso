import json, sys, random, collections, pathlib
out = pathlib.Path(sys.argv[1])
rows = [json.loads(l) for l in (out / "normalized/normalized.jsonl").read_text().splitlines()]
raw = {}
for f in ["issues", "issue_comments"]:
    for l in (out / f"raw/{f}.jsonl").read_text().splitlines():
        r = json.loads(l); raw[(r["source_type"], r["source_id"])] = r
sub = [r for r in rows if r["intent"] in ("submission", "submission_unclear")]
n = len(sub)
cov = lambda f: sum(1 for r in sub if f(r))
print("submission-ish", n)
for k, f in [("repo_key", lambda r: r["claims"]["repo_key"]), ("name", lambda r: r["claims"]["name"]), ("description", lambda r: r["claims"]["description"]),
             ("endpoint", lambda r: r["claims"]["endpoints"]), ("package", lambda r: r["claims"]["package_ids"]), ("install", lambda r: r["claims"]["install_command"]),
             ("license", lambda r: r["claims"]["license"]), ("homepage", lambda r: r["claims"]["homepage"]), ("hosting", lambda r: r["claims"]["hosting"]),
             ("no repo/endpoint/package", lambda r: not (r["claims"]["repo_key"] or r["claims"]["endpoints"] or r["claims"]["package_ids"]))]:
    print(f"  {k}: {cov(f)} ({cov(f)/n:.1%})")
print("security flags", collections.Counter(fl["code"].split(":")[0] for r in rows for fl in r["security_flags"]).most_common())
print("by type/intent", collections.Counter((r["source"]["type"], r["intent"]) for r in rows))
random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
for r in random.sample(sub, int(sys.argv[3]) if len(sys.argv) > 3 else 12):
    c = r["claims"]
    s = raw[(r["source"]["type"], r["source"]["id"])]
    print("\n---", r["record_id"], r["source"]["url"])
    print("  TITLE:", (s.get("title") or "")[:90], "| BODY:", (s["body"] or "")[:200].replace("\n", " / "))
    print("  => name=%r repo=%r pkg=%s ep=%s host=%s lic=%r desc=%r" % (c["name"], c["repo_key"], c["package_ids"], [e["url"] for e in c["endpoints"]][:2], c["hosting"], c["license"], (c["description"] or "")[:70]))
