#!/usr/bin/env node
// Stage 2 — normalise raw source records into structured submission claims.
//   node tools/upstream-import/normalize.mjs --out data/upstream-import
// Reads  <out>/raw/*.jsonl      Writes <out>/normalized/normalized.jsonl (+ .csv)
// Raw data is never modified. Every normalised record keeps a pointer to its source.

import path from "node:path";
import { parseArgs } from "node:util";
import { readJsonl, writeJsonlAtomic, ensureDir, writeJsonAtomic, writeCsv } from "./lib/store.mjs";
import { extractClaims, classifyIntent } from "./lib/extract.mjs";
import { securityFlags } from "./lib/flags.mjs";

const MAX_TEXT_CHARS = 100_000; // input cap for pattern matching; raw/ keeps the full text
const SUBMISSION_THREAD = 1; // upstream issue #1 "Submit Your MCP Servers here"

export function normalizeOne(src, { threadNumber = SUBMISSION_THREAD } = {}) {
  const isComment = src.source_type === "issue_comment";
  const title = isComment ? "" : (src.title || "").slice(0, 1000);
  const body = (src.body || "").slice(0, MAX_TEXT_CHARS);
  const claims = extractClaims(title, body);
  const { intent, reason } = classifyIntent({ title, body, claims, sourceType: src.source_type });
  const prefix = { issue: "issue", pull_request: "pr", issue_comment: "comment" }[src.source_type];
  const quality_flags = [];
  if (!(body || "").trim()) quality_flags.push("empty_body");
  if (claims.tools_explicitly_empty) quality_flags.push("tools_not_listed");
  if (claims.repo_candidates.length > 1 && new Set(claims.labeled_repo_keys).size > 1) quality_flags.push("conflicting_labeled_repositories");
  if (src.author_type === "Bot") quality_flags.push("author_is_bot_account");
  const refs = [...(body.matchAll(/\b(?:closes|fixes|resolves)\s+#(\d+)/gi))].map((m) => Number(m[1]));
  return {
    record_id: `${prefix}:${src.source_id}`,
    source: {
      repo: src.source_repo, type: src.source_type, number: src.source_number, id: src.source_id, url: src.source_url,
      author_login: src.author_login, author_type: src.author_type, author_association: src.author_association,
      created_at: src.created_at, updated_at: src.updated_at, closed_at: src.closed_at ?? null,
      state: src.state ?? null, state_reason: src.state_reason ?? null,
      merged: src.merged ?? null, collected_at: src.collected_at,
      parent_issue_number: isComment ? src.source_number : null,
      in_submission_thread: isComment && src.source_number === threadNumber,
      references_issues: refs,
    },
    intent, intent_reason: reason,
    claims,
    security_flags: securityFlags(`${title}\n${body}`, claims),
    quality_flags,
  };
}

export function main(argv = process.argv.slice(2)) {
  const { values: a } = parseArgs({ args: argv, options: { out: { type: "string", default: "data/upstream-import" } } });
  const out = path.resolve(a.out);
  const raw = (f) => readJsonl(path.join(out, "raw", f));
  const issues = raw("issues.jsonl");
  const prs = raw("pull_requests.jsonl");
  const comments = raw("issue_comments.jsonl");
  const rows = [];
  for (const i of issues) rows.push(normalizeOne(i));
  for (const p of prs) rows.push(normalizeOne(p));
  // Only comments in the designated submission thread are treated as potential submissions;
  // other comments are discussion on a record and stay in raw/ only.
  for (const c of comments) if (c.source_number === SUBMISSION_THREAD) rows.push(normalizeOne(c));
  rows.sort((x, y) => (x.source.created_at < y.source.created_at ? -1 : 1));
  ensureDir(path.join(out, "normalized"));
  writeJsonlAtomic(path.join(out, "normalized", "normalized.jsonl"), rows);

  const csvCols = ["record_id", "source_type", "source_number", "source_url", "author_login", "created_at", "state", "intent", "name", "repo_key", "package_ids", "endpoints", "hosting", "transports", "license", "category", "security_flags", "quality_flags"];
  writeCsv(path.join(out, "normalized", "normalized.csv"), csvCols, rows.map((r) => ({
    record_id: r.record_id, source_type: r.source.type, source_number: r.source.number, source_url: r.source.url, author_login: r.source.author_login,
    created_at: r.source.created_at, state: r.source.state, intent: r.intent, name: r.claims.name, repo_key: r.claims.repo_key, package_ids: r.claims.package_ids,
    endpoints: r.claims.endpoints.map((e) => e.url), hosting: r.claims.hosting, transports: r.claims.transports, license: r.claims.license, category: r.claims.category,
    security_flags: r.security_flags.map((f) => f.code), quality_flags: r.quality_flags,
  })), { privateCols: ["author_login", "name"] });
  const intents = {};
  for (const r of rows) intents[r.intent] = (intents[r.intent] || 0) + 1;
  writeJsonAtomic(path.join(out, "normalized", "normalize-summary.json"), { generated_at: new Date().toISOString(), records: rows.length, by_source_type: { issues: issues.length, pull_requests: prs.length, submission_thread_comments: rows.filter((r) => r.source.in_submission_thread).length }, intents });
  console.error(JSON.stringify({ event: "normalized", records: rows.length, intents }));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
