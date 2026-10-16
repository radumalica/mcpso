#!/usr/bin/env bash
# Builds a THROWAWAY COPY of the app with the single build-breaking type error patched, only to
# measure bundle sizes/route output. The repository itself is not modified.
set -u
SRC=/home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit
DST=/home/ubuntu/.claude/jobs/00ec914d/tmp/buildcopy
rm -rf "$DST"; mkdir -p "$DST"
cd "$SRC" || exit 1
tar --exclude=./node_modules --exclude=./.next --exclude=./data --exclude=./reports --exclude=./tools --exclude=./.git -cf - . | tar -xf - -C "$DST"
ln -s "$SRC/node_modules" "$DST/node_modules"
cd "$DST" || exit 1
# the one-line fix used only for measurement:
sed -i 's/import { useRouter } from "next\/navigation";/import { useRouter } from "next\/navigation";\nimport type { KeyboardEvent } from "react";/' templates/tailspark/landing/components/search/index.tsx
{
echo "# patched copy build (diff vs repo = add 'import type { KeyboardEvent } from \"react\"' in search/index.tsx)"
NEXT_TELEMETRY_DISABLED=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=dummy NEXT_PUBLIC_WEB_URL=http://localhost:3000 OPENAI_API_KEY=dummy OPENAI_MODEL=dummy \
  timeout 600 npx --no-install next build 2>&1 | sed 's/\x1b\[[0-9;]*m//g'
echo "# exit code: ${PIPESTATUS[0]}"
} > "$SRC/reports/evidence/build-patched-copy.txt" 2>&1
tail -45 "$SRC/reports/evidence/build-patched-copy.txt"
