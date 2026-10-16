#!/usr/bin/env bash
# Pattern-based secret scan of the working tree AND full git history (all branches).
# Prints only pattern names, file paths, and a masked match (first 4 chars) — never full values.
set -u
cd /home/ubuntu/git/mcpso/.claude/worktrees/mcp-registry-audit || exit 1
OUT=reports/evidence/secret-scan.txt
{
echo "# tools available:"; for t in gitleaks trufflehog semgrep bandit detect-secrets eslint; do printf "%s: " $t; command -v $t || echo "not installed"; done
echo
echo "# commits scanned:"; git rev-list --all | wc -l
PATTERNS='AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|(SUPABASE|OPENAI|JINA|SERVICE_ROLE|SECRET|PASSWORD|TOKEN)[A-Z_]*[ ]*[=:][ ]*["'"'"']?[A-Za-z0-9_./+-]{16,}'
echo "# working tree hits (masked):"
git grep -nIE "$PATTERNS" -- . ':!pnpm-lock.yaml' ':!package-lock.json' ':!reports' ':!tools' ':!data' | sed -E 's/(.{0,160}).*/\1/' | sed -E 's/([A-Za-z0-9_+\/=-]{4})[A-Za-z0-9_+\/=.-]{12,}/\1[masked]/g' | head -40
echo "# history hits (any revision; masked):"
git log --all -p -G"$PATTERNS" --pickaxe-regex --format='commit %h' -- . ':!pnpm-lock.yaml' ':!package-lock.json' 2>/dev/null | grep -E '^(commit |[+-].*('"$PATTERNS"'))' | sed -E 's/([A-Za-z0-9_+\/=-]{4})[A-Za-z0-9_+\/=.-]{12,}/\1[masked]/g' | cut -c1-200 | head -40
echo "# tracked env-like files:"; git ls-files | grep -iE '(^|/)\.env|\.pem$|\.key$|id_rsa|credentials|secrets?\.(json|ya?ml)$' || echo "none tracked"
echo "# public IDs in source (not secrets): "; git grep -nE 'ca-pub-[0-9]+' | cut -c1-140
} > "$OUT" 2>&1
cat "$OUT"
