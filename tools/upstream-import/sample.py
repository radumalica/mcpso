import json, sys, pathlib, random
raw = pathlib.Path(sys.argv[1]) / "raw"
issues = [json.loads(l) for l in (raw / "issues.jsonl").read_text().splitlines()]
mode = sys.argv[2]
random.seed(7)
if mode == "author":
    sel = [i for i in issues if i["author_login"] == sys.argv[3]]
elif mode == "other":
    sel = [i for i in issues if not (i["title"] or "").lower().startswith(("submit", "add"))]
elif mode == "add":
    sel = [i for i in issues if (i["title"] or "").lower().startswith("add")]
elif mode == "closed":
    sel = [i for i in issues if i["state"] == "closed"]
elif mode == "bot":
    sel = [i for i in issues if i["author_type"] == "Bot"]
n = int(sys.argv[4]) if len(sys.argv) > 4 else 8
for i in random.sample(sel, min(n, len(sel))):
    print(f"#{i['source_number']} {i['state']}/{i['state_reason']} {i['author_login']} {i['created_at'][:10]} | {i['title'][:100]}")
    print("    ", (i["body"] or "")[:420].replace("\n", "\\n"))
