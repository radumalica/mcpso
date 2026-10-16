#!/usr/bin/env bash
cd /home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit || exit 1
{ echo '$ npx --no-install tsc --noEmit -p tsconfig.json   # re-run after next dev/build generated next-env.d.ts'
  npx --no-install tsc --noEmit -p tsconfig.json; echo "# exit code: $?"; } > reports/evidence/tsc-after-next-env.txt 2>&1
cat reports/evidence/tsc-after-next-env.txt
ls next-env.d.ts
