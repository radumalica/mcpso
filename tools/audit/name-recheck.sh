#!/usr/bin/env bash
# Independent re-check (by the lead, not the research subagent) of the three finalist names.
# A DNS NS hit = registered/delegated; no hit does NOT prove a domain is purchasable.
for d in cairnbase.com cairnbase.dev cairnbase.org cairnbase.io lodehaven.com lodehaven.dev lodehaven.org lodehaven.io cairnindex.com cairnindex.dev cairnindex.org cairnindex.io; do
  ns=$(dig +short NS "$d" | head -2 | tr '\n' ' ')
  echo "$d NS: ${ns:-<none>}"
done
for n in cairnbase lodehaven cairnindex; do
  u=$(gh api "users/$n" --jq .login 2>&1 | head -1)
  npm=$(curl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/$n")
  pypi=$(curl -s -o /dev/null -w "%{http_code}" "https://pypi.org/pypi/$n/json")
  echo "$n github-login: $u | npm:$npm pypi:$pypi"
done
