import json, sys, pathlib, collections
out = pathlib.Path(sys.argv[1])
rows = [json.loads(l) for l in (out / "normalized/normalized.jsonl").read_text().splitlines()]
by = collections.defaultdict(list)
for r in rows:
    for f in r["security_flags"]:
        by[f["code"].split(":")[0]].append((r["record_id"], r["source"]["url"].split("chatmcp/mcpso/")[-1], f["detail"][:110].replace("\n", " ")))
for code, items in by.items():
    print(f"## {code}: {len(items)} records")
    for it in items[: int(sys.argv[2])]:
        print("  ", it)
