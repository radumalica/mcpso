#!/usr/bin/env bash
# Reproducible audit checks. Writes raw command output to reports/evidence/.
# Read-only with respect to application source: no upgrades, no config edits.
# Usage: bash tools/audit/run-checks.sh   (from repo root, after `pnpm install --frozen-lockfile --ignore-scripts`)
set -u
EV=reports/evidence
mkdir -p "$EV"
export NEXT_TELEMETRY_DISABLED=1 CI=1

run() { # run <name> <timeout-seconds> <command...>
  local name=$1 t=$2; shift 2
  {
    echo "\$ $*"
    echo "# started: $(date -u +%FT%TZ)"
    timeout "$t" "$@" </dev/null 2>&1
    echo "# exit code: $?"
  } > "$EV/$name.txt"
  echo "== $name: $(tail -1 "$EV/$name.txt")"
}

run versions 30 bash -c 'node -v; npm -v; pnpm -v; npx --no-install tsc -v; python3 --version'
run tsc 300 npx --no-install tsc --noEmit -p tsconfig.json
run next-lint 120 npx --no-install next lint
run build 600 env SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=dummy NEXT_PUBLIC_WEB_URL=http://localhost:3000 OPENAI_API_KEY=dummy OPENAI_MODEL=dummy npx --no-install next build
run pnpm-audit 180 pnpm audit --json
run pnpm-audit-prod 180 pnpm audit --prod
run npm-audit 180 npm audit --package-lock-only --json
run pnpm-outdated 180 pnpm outdated --format json
run pnpm-ls-depth0 60 pnpm ls --depth 0
run lockfile-drift 60 pnpm install --frozen-lockfile --ignore-scripts --lockfile-only
run test-script 30 bash -c 'grep -n "\"test\"" package.json || echo "no test script in package.json"; find . -path ./node_modules -prune -o \( -name "*.test.*" -o -name "*.spec.*" -o -name "__tests__" \) -print | grep -v tools/ || echo "no test files outside tools/"'
run ci-config 30 bash -c 'ls -la .github 2>&1; ls .gitlab-ci.yml .circleci Dockerfile docker-compose.yml wrangler.toml vercel.json 2>&1'
run lifecycle-scripts 60 bash -c 'grep -n "\"\\(pre\\|post\\)\\?install\"" package.json || echo "no install lifecycle scripts in root package.json"; pnpm -s ls --depth 0 --json >/dev/null 2>&1; echo; echo "-- pnpm onlyBuiltDependencies / ignored builds:"; pnpm ignored-builds 2>&1 | head -30'
