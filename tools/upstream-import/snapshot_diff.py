"""Compare two raw snapshots of the upstream tracker: records that disappeared, are new, or changed (title/body/state).
Usage: python3 -I tools/upstream-import/snapshot_diff.py <old_out_dir> <new_out_dir>"""
import json, sys
a, b = sys.argv[1:3]
def load(d, f):
    return {r["source_id"]: r for r in map(json.loads, open(f"{d}/raw/{f}.jsonl"))}
for f in ["issues", "pull_requests", "issue_comments"]:
    A, B = load(a, f), load(b, f)
    gone, new = set(A) - set(B), set(B) - set(A)
    both = set(A) & set(B)
    body = [i for i in both if A[i].get("body") != B[i].get("body")]
    title = [i for i in both if A[i].get("title") != B[i].get("title")]
    state = [i for i in both if A[i].get("state") != B[i].get("state")]
    print(f"{f}: old {len(A)} new {len(B)} | disappeared {len(gone)} | new {len(new)} | body changed {len(body)} | title changed {len(title)} | state changed {len(state)}")
