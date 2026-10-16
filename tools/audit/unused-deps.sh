#!/usr/bin/env bash
cd /home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit || exit 1
OUT=reports/evidence/unused-deps.txt
{
echo "# For each declared dependency: number of source files importing it (app/ components/ models/ providers/ services/ templates/ types/ utils/)"
for d in $(node -e 'const p=require("./package.json");console.log(Object.keys({...p.dependencies,...p.devDependencies}).join(" "))'); do
  n=$(grep -rlE "from ['\"]${d}(/[^'\"]*)?['\"]|require\(['\"]${d}(/[^'\"]*)?['\"]\)|import ['\"]${d}(/[^'\"]*)?['\"]" app components models providers services templates types utils next.config.mjs tailwind.config.ts postcss.config.mjs 2>/dev/null | wc -l)
  echo "$n  $d"
done | sort -n
echo
echo "# sitemap entry counts"; grep -c "<loc>" public/sitemap_projects_1.xml public/sitemap_categories_1.xml public/sitemap.xml public/sitemap_index_1.xml
echo "# sitemap host(s)"; grep -ho "https\?://[^/<]*" public/sitemap*.xml | sort | uniq -c
echo "# line counts of source files"; wc -l $(git ls-files 'app/*.ts' 'app/*.tsx' 'app/**/*.ts' 'app/**/*.tsx' 'models/*' 'services/*.ts' 'services/**/*.ts' 'utils/*' 'templates/**/*.tsx' 'components/**/*.tsx' 'providers/*' 'types/*' | sort -u) | tail -1
echo "# runtime=edge routes"; grep -rl 'runtime = "edge"' app | sort
echo "# files using 'use client'"; grep -rl '"use client"' app components templates providers | sort
echo "# TS 'any' occurrences"; grep -rnE ': any\b|as any\b|<any>' app components models services templates utils providers | wc -l
echo "# console.log occurrences in server code"; grep -rn "console.log" app models services utils | wc -l
echo "# dead code candidates"; grep -rn "dropdown\|DropDown" templates | head -3
} > "$OUT" 2>&1
cat "$OUT"
