#!/usr/bin/env bash
# Runs the app (dev mode) against the fake PostgREST fixture server, fetches pages,
# records the PostgREST requests the app issued, and takes headless-Chromium screenshots.
# Nothing here touches a real database or any external service (the app's outbound
# calls: avatar images only; fonts are local).
set -u
ROOT=/home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit
EV=$ROOT/reports/evidence/ui
mkdir -p "$EV"
cd "$ROOT" || exit 1
CHROME=$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | tail -1)
: > "$EV/postgrest-requests.log"
node tools/audit/fake-postgrest.mjs 54399 "$EV/postgrest-requests.log" > "$EV/fake-postgrest.out" 2>&1 &
FP=$!
SUPABASE_URL=http://127.0.0.1:54399 SUPABASE_ANON_KEY=dummy NEXT_PUBLIC_WEB_URL=http://localhost:8051 NEXT_TELEMETRY_DISABLED=1 \
  npx --no-install next dev -p 8051 > "$EV/next-dev.out" 2>&1 &
ND=$!
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:8051/ && break; sleep 1; done
fetch() { # name path
  curl -s -m 60 -o "$EV/$1.html" -w "$1 $2 -> HTTP %{http_code}, %{size_download} bytes, %{time_total}s\n" "http://localhost:8051$2"
}
{
fetch home /
fetch search "/?q=filesystem"
fetch search-inject "/?q=x%2Cstatus.eq.deleted"
fetch categories /categories
fetch category /category/developer-tools
fetch category-missing /category/does-not-exist
fetch server /server/fixture-1
fetch server-missing /server/does-not-exist
fetch server-wrong-slug /whatever/fixture-1
fetch privacy /privacy-policy
fetch robots /robots.txt
fetch sitemap /sitemap.xml
} > "$EV/fetch-summary.txt" 2>&1
if [ -n "$CHROME" ]; then
  for spec in "home:/:1280,1000" "home-mobile:/:390,900" "server:/server/fixture-1:1280,1400" "server-mobile:/server/fixture-1:390,1400" "categories:/categories:1280,900" "category-missing:/category/does-not-exist:1280,500"; do
    n=${spec%%:*}; rest=${spec#*:}; p=${rest%%:*}; sz=${rest##*:}
    timeout 90 "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --virtual-time-budget=8000 --window-size=$sz --screenshot="$EV/$n.png" "http://localhost:8051$p" > "$EV/chrome-$n.out" 2>&1
  done
  echo "chrome: $CHROME" >> "$EV/fetch-summary.txt"
else
  echo "NO CHROMIUM FOUND: visual review not performed" >> "$EV/fetch-summary.txt"
fi
kill $ND $FP 2>/dev/null
sleep 1; pkill -f "next dev -p 8051" 2>/dev/null; pkill -f "fake-postgrest.mjs 54399" 2>/dev/null
cat "$EV/fetch-summary.txt"
