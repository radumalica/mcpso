import json, sys, pathlib, collections
out = pathlib.Path(sys.argv[1])
ps = [json.loads(l) for l in (out / "dedup" / sys.argv[2]).read_text().splitlines()]
for p in sorted(ps, key=lambda p: -p["source_count"])[:int(sys.argv[3])]:
    print(p["source_count"], p["canonical_key"], p["identity_type"], "authors:", p["authors"][:4], "| names:", [c["value"] for c in p["claim_conflicts"].get("name", [])][:4] or p["merged_claims"]["name"])
    print("   amb:", [f["code"] for f in p["ambiguity_flags"]], "| reasons:", collections.Counter(r["rule"] for r in p["merge_reasons"]))
print(collections.Counter(f["code"] for p in ps for f in p["ambiguity_flags"]))
