#!/usr/bin/env bash
# Probes the app's API routes for missing authorization/validation against the FIXTURE backend
# (tools/audit/fake-postgrest.mjs). No real database, LLM, or third-party service is contacted:
# OPENAI_* are dummy values and the probes below never reach the LLM path.
set -u
ROOT=/home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit
EV=$ROOT/reports/evidence/api-probe
mkdir -p "$EV"; cd "$ROOT" || exit 1
: > "$EV/postgrest-requests.log"
node tools/audit/fake-postgrest.mjs 54398 "$EV/postgrest-requests.log" > "$EV/fake.out" 2>&1 &
FP=$!
SUPABASE_URL=http://127.0.0.1:54398 SUPABASE_ANON_KEY=dummy NEXT_PUBLIC_WEB_URL=http://localhost:8052 NEXT_TELEMETRY_DISABLED=1 \
  OPENAI_API_KEY=dummy OPENAI_BASE_URL=http://127.0.0.1:9 OPENAI_MODEL=dummy npx --no-install next dev -p 8052 > "$EV/next.out" 2>&1 &
ND=$!
for i in $(seq 1 90); do curl -s -o /dev/null -m 5 http://localhost:8052/api/submit-project -X POST -H 'content-type: application/json' -d '{}' && break; sleep 1; done
: > "$EV/postgrest-requests.log"
post() { # name path json
  echo "### $1: POST $2 $3" >> "$EV/results.txt"
  curl -s -m 60 -X POST "http://localhost:8052$2" -H 'content-type: application/json' -d "$3" -w "\nHTTP %{http_code}\n" >> "$EV/results.txt" 2>&1
  echo >> "$EV/results.txt"
}
: > "$EV/results.txt"
# 1. No credentials; overwrite an EXISTING listing (name matches fixture-1) and soft-delete it
post overwrite-existing /api/submit-project '{"url":"https://github.com/example/fixture-1","name":"fixture-1","title":"OVERWRITTEN","description":"attacker text","summary":"[phish](https://evil.example)","status":"deleted","is_featured":true,"sort":999}'
# 2. Host-prefix bypass of the github.com check
post prefix-bypass /api/submit-project '{"url":"https://github.com.evil.example/x/y","name":"evil-listing"}'
# 3. Client-controlled server-side fields on a NEW listing
post mass-assignment-new /api/submit-project '{"url":"https://github.com/example/new-one","name":"new-one","uuid":"attacker-chosen","avatar_url":"javascript:alert(1)","img_url":"https://tracker.example/pixel.gif","author_name":"Anthropic (official)"}'
# 4. Bulk endpoint: 200 items in one request, no limit
BIG=$(node -e 'console.log(JSON.stringify(Array.from({length:200},(_,i)=>({url:"https://github.com/spam/repo"+i}))))')
post bulk-200 /api/submit-projects "$BIG"
# 5. Unbounded page size on summarize-projects (DB side only; no rows lack summary in fixtures with odd index)
post summarize-unbounded /api/summarize-projects '{"page":1,"limit":100000}'
# 6. Malformed JSON leaks nothing but returns HTTP 200
post malformed /api/submit-project '{not json'
cp "$EV/postgrest-requests.log" "$EV/postgrest-requests-after-probes.log"
kill $ND $FP 2>/dev/null; sleep 1
pkill -f "next dev -p 8052" 2>/dev/null; pkill -f "fake-postgrest.mjs 54398" 2>/dev/null
cat "$EV/results.txt"
echo "=== requests the app sent to the database (method path) ==="
python3 -I -c "
import json
for l in open('$EV/postgrest-requests-after-probes.log'):
    d=json.loads(l); print(d['method'], d['path'][:170])
" | sort | uniq -c | sort -rn | head -20
