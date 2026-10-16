import json, sys, pathlib, collections
out = pathlib.Path(sys.argv[1])
rows = [json.loads(l) for l in (out / "enrichment/repos.jsonl").read_text().splitlines()]
C = collections.Counter
print("repos", len(rows), "resolved", sum(r["resolved"] for r in rows))
print("unresolved reasons", C(r.get("reason") for r in rows if not r["resolved"]))
res = [r for r in rows if r["resolved"]]
print("renamed", sum(r["renamed"] for r in res), "archived", sum(r["archived"] for r in res), "fork", sum(r["fork"] for r in res), "empty", sum(r["empty"] for r in res), "template", sum(r["template"] for r in res))
print("license null/NOASSERTION", sum(1 for r in res if not r["license_spdx"] or r["license_spdx"] == "NOASSERTION"), "of", len(res))
print("with sdk_evidence", sum(1 for r in res if r["sdk_evidence"]), "| mcp topics", sum(1 for r in res if r["mcp_topics"]), "| readme mention", sum(1 for r in res if r["readme_mcp_mention"]), "| desc mention", sum(1 for r in res if r["description_mentions_mcp"]))
print("sdk signals", C(e["signal"].split(":")[0] + ":" + e["signal"].split(":")[1] if ":" in e["signal"] else e["signal"] for r in res for e in r["sdk_evidence"]).most_common(12))
print("readme_bytes==0", sum(1 for r in res if r["readme_bytes"] == 0))
print("no signals at all", sum(1 for r in res if not r["sdk_evidence"] and not r["mcp_topics"] and not r["readme_mcp_mention"] and not r["description_mentions_mcp"]))
print("languages", C(r["primary_language"] for r in res).most_common(8))
