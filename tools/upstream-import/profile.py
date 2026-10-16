"""Quick exploratory profile of raw issues/comments (used to design extraction rules)."""
import json, re, sys, collections, pathlib
raw = pathlib.Path(sys.argv[1]) / "raw"
rd = lambda f: [json.loads(l) for l in (raw / f).read_text().splitlines() if l.strip()]
issues, comments, prs = rd("issues.jsonl"), rd("issue_comments.jsonl"), rd("pull_requests.jsonl")
C = collections.Counter
print("issues", len(issues), "comments", len(comments), "prs", len(prs))
print("state", C(i["state"] for i in issues))
print("state_reason", C(i["state_reason"] for i in issues))
print("labels", C(l for i in issues for l in i["labels"]).most_common(10))
print("author_type", C(i["author_type"] for i in issues))
print("assoc", C(i["author_association"] for i in issues))
print("empty body", sum(1 for i in issues if not (i["body"] or "").strip()))
print("unique authors", len({i["author_login"] for i in issues}))
print("top authors", C(i["author_login"] for i in issues).most_common(8))
pat = C()
for i in issues:
    t = (i["title"] or "").lower()
    k = "submit remote" if t.startswith("submit remote") else "submit mcp server" if t.startswith("submit mcp server") else "submit:" if t.startswith("submit") else "add" if t.startswith("add") else "other"
    pat[k] += 1
print("title patterns", pat)
gh = re.compile(r"https?://(?:www\.)?github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", re.I)
print("issues with a github repo url", sum(1 for i in issues if gh.search((i["body"] or "") + " " + (i["title"] or ""))))
print("comments on #1", sum(1 for c in comments if c["source_number"] == 1), "comments elsewhere", sum(1 for c in comments if c["source_number"] != 1))
print("comment parents top", C(c["source_number"] for c in comments).most_common(8))
print("comments w/ gh url", sum(1 for c in comments if gh.search(c["body"] or "")))
print("issue numbers range", min(i["source_number"] for i in issues), max(i["source_number"] for i in issues))
by_month = C(i["created_at"][:7] for i in issues)
print("by month", sorted(by_month.items()))
# issues by comment count
print("issues with comments>0", [(i["source_number"], i["comments_count"]) for i in issues if i["comments_count"] > 0][:15])
body_len = sorted(len(i["body"] or "") for i in issues)
print("body len p50/p90/p99/max", body_len[len(body_len)//2], body_len[int(len(body_len)*.9)], body_len[int(len(body_len)*.99)], body_len[-1])
