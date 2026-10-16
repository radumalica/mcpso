#!/usr/bin/env node
// Stage 1 — collect raw source records from the upstream GitHub repository.
//
//   GITHUB_TOKEN=... node tools/upstream-import/collect.mjs --out data/upstream-import
//   node tools/upstream-import/collect.mjs --use-gh-token            # token from `gh auth token`
//
// Stages: issues, pulls, comments, pull_files. Resumable (checkpoint in
// <out>/state/collect.json), incremental (--incremental uses `since`), and
// idempotent (records are keyed; later copies replace earlier ones).
//
// Output (all under <out>/raw/):
//   issues.jsonl         issues only (PRs returned by the issues endpoint are excluded)
//   pull_requests.jsonl  pull requests from the pulls endpoint (includes merged_at)
//   issue_comments.jsonl comments on any issue/PR (repo-wide listing)
//   pull_files.jsonl     changed files (+ capped patch text) per PR — UNTRUSTED TEXT
//   errors.jsonl         per-record retrieval problems
// And <out>/manifest.json with counts.

import path from "node:path";
import { parseArgs } from "node:util";
import { GitHubClient, resolveToken } from "./lib/github.mjs";
import { contentHash } from "./load.mjs";
import {
  appendJsonl, compactJsonl, ensureDir, makeLogger, readJson, readJsonl, writeJsonAtomic,
} from "./lib/store.mjs";

const PATCH_CAP = 60_000;

function pruneUser(u) {
  return u ? { login: u.login, id: u.id, type: u.type } : null;
}

/** Flatten an issue/PR API object to the fields we preserve. */
export function toIssueRecord(repo, it, collectedAt) {
  const rec = {
    source_repo: repo,
    source_type: "issue",
    source_id: it.id,
    source_number: it.number,
    source_url: it.html_url,
    author_login: it.user?.login ?? null,
    author_type: it.user?.type ?? null,
    author_association: it.author_association ?? null,
    created_at: it.created_at,
    updated_at: it.updated_at,
    closed_at: it.closed_at ?? null,
    state: it.state,
    state_reason: it.state_reason ?? null,
    locked: !!it.locked,
    labels: (it.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
    comments_count: it.comments ?? 0,
    title: it.title ?? null,
    body: it.body ?? null,
    collected_at: collectedAt,
  };
  rec.missing_fields = Object.entries({ title: rec.title, body: rec.body, author_login: rec.author_login })
    .filter(([, v]) => v === null || v === "")
    .map(([k]) => k);
  return rec;
}

export function toPullRecord(repo, it, collectedAt) {
  return {
    ...toIssueRecord(repo, it, collectedAt),
    source_type: "pull_request",
    merged_at: it.merged_at ?? null,
    merged: !!it.merged_at,
    draft: !!it.draft,
    base_ref: it.base?.ref ?? null,
    head_repo: it.head?.repo?.full_name ?? null, // null when the fork was deleted
    head_ref: it.head?.ref ?? null,
    head_sha: it.head?.sha ?? null,
    merge_commit_sha: it.merge_commit_sha ?? null,
  };
}

export function toCommentRecord(repo, c, collectedAt) {
  const num = Number(String(c.issue_url || "").split("/").pop());
  return {
    source_repo: repo,
    source_type: "issue_comment",
    source_id: c.id,
    source_number: Number.isFinite(num) ? num : null, // parent issue/PR number
    source_url: c.html_url,
    author_login: c.user?.login ?? null,
    author_type: c.user?.type ?? null,
    author_association: c.author_association ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    body: c.body ?? null,
    collected_at: collectedAt,
    missing_fields: c.body ? [] : ["body"],
  };
}

const keyOf = (r) => `${r.source_type}:${r.source_id}`;

async function runListStage({ name, client, log, state, saveState, file, urlFor, extract, incremental, force, maxPages, runStartedAt, batchId, dryRun }) {
  const st = (state.stages[name] ||= { complete: false, next_url: null, watermark: null, pages: 0, fetched: 0 });
  let url;
  if (st.complete && !incremental && !force) {
    log({ event: "stage_skip", stage: name, reason: "complete" });
    return;
  }
  if (st.complete && incremental) {
    url = urlFor(st.watermark);
    st.complete = false; st.next_url = url; st.pages = 0; st.fetched = 0;
  } else if (st.complete && force) {
    st.watermark = null; url = urlFor(null); st.complete = false; st.pages = 0; st.fetched = 0;
  } else {
    url = st.next_url || urlFor(null);
  }
  log({ event: "stage_start", stage: name, resume_from: url });

  // Previous versions: when a re-collected record differs from the stored one, the old version is kept in revisions.jsonl.
  const known = new Map(dryRun ? [] : readJsonl(file).map((r) => [keyOf(r), r]));
  const revisionsFile = path.join(path.dirname(file), "revisions.jsonl");
  let pagesThisRun = 0;
  for await (const page of client.pages(null, { startUrl: url })) {
    const collectedAt = new Date().toISOString();
    const rows = page.items.map((it) => extract(it, collectedAt)).filter(Boolean).map((r) => ({ ...r, batch_id: batchId }));
    if (!dryRun) {
      const changed = rows.filter((r) => known.has(keyOf(r)) && contentHash(known.get(keyOf(r))) !== contentHash(r))
        .map((r) => ({ key: keyOf(r), superseded: known.get(keyOf(r)), superseded_at: collectedAt, batch_id: batchId }));
      appendJsonl(revisionsFile, changed);
      for (const r of rows) known.set(keyOf(r), r);
      appendJsonl(file, rows);
    }
    st.pages += 1;
    st.fetched += rows.length;
    st.next_url = page.next;
    pagesThisRun += 1;
    saveState();
    log({ event: "page", stage: name, page: st.pages, items: page.items.length, kept: rows.length, total_kept: st.fetched, rate_remaining: client.rate.remaining });
    if (dryRun) {
      log({ event: "dry_run_stage_sampled", stage: name, items: page.items.length, has_more: !!page.next });
      return;
    }
    if (maxPages && pagesThisRun >= maxPages && page.next) {
      log({ event: "stage_paused", stage: name, reason: "--max-pages" });
      return;
    }
  }
  const n = compactJsonl(file, keyOf);
  st.complete = true;
  st.next_url = null;
  // Anything updated after this run started is picked up by the next --incremental run.
  st.watermark = new Date(Date.parse(runStartedAt) - 60_000).toISOString();
  saveState();
  log({ event: "stage_done", stage: name, unique_records: n });
}

async function runPullFiles({ client, log, state, saveState, file, errFile, repo, pulls, maxPages }) {
  const st = (state.stages.pull_files ||= { complete: false, done: [] });
  const done = new Set(st.done);
  let n = 0;
  for (const pr of pulls) {
    if (done.has(pr.source_number)) continue;
    const url = `repos/${repo}/pulls/${pr.source_number}/files?per_page=100`;
    const files = [];
    let error = null;
    try {
      for await (const page of client.pages(url)) {
        for (const f of page.items) {
          const patch = typeof f.patch === "string" ? f.patch : null;
          files.push({
            filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions,
            patch: patch && patch.length > PATCH_CAP ? patch.slice(0, PATCH_CAP) : patch,
            patch_truncated: !!(patch && patch.length > PATCH_CAP),
          });
        }
      }
    } catch (e) {
      error = { message: String(e.message || e), status: e.status ?? null };
      appendJsonl(errFile, [{ stage: "pull_files", source_number: pr.source_number, ...error, at: new Date().toISOString() }]);
      log({ level: "warn", event: "pull_files_error", number: pr.source_number, ...error });
    }
    appendJsonl(file, [{
      source_repo: repo, source_type: "pull_request_files", source_id: pr.source_id, source_number: pr.source_number,
      source_url: pr.source_url, files, error, collected_at: new Date().toISOString(),
    }]);
    st.done.push(pr.source_number);
    saveState();
    if (maxPages && ++n >= maxPages) return;
  }
  compactJsonl(file, keyOf);
  st.complete = true;
  saveState();
  log({ event: "stage_done", stage: "pull_files", prs: pulls.length });
}

export async function main(argv = process.argv.slice(2), { clientOptions = {} } = {}) {
  const { values: a } = parseArgs({
    args: argv,
    options: {
      out: { type: "string", default: "data/upstream-import" },
      repo: { type: "string", default: "chatmcp/mcpso" },
      stages: { type: "string", default: "issues,pulls,comments,pull_files" },
      incremental: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "use-gh-token": { type: "boolean", default: false },
      "max-pages": { type: "string" },
      quiet: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const out = path.resolve(a.out);
  const raw = path.join(out, "raw");
  ensureDir(raw);
  const runStartedAt = new Date().toISOString();
  const log = makeLogger(path.join(out, "logs", `collect-${runStartedAt.replace(/[:.]/g, "-")}.log`), { quiet: a.quiet });
  const token = resolveToken({ useGh: a["use-gh-token"] });
  const client = new GitHubClient({ token, log, ...clientOptions });
  log({ event: "start", dry_run: a["dry-run"], repo: a.repo, authenticated: !!token, stages: a.stages, incremental: a.incremental });

  const stateFile = path.join(out, "state", "collect.json");
  const state = readJson(stateFile, { version: 1, repo: a.repo, stages: {}, runs: [] });
  if (state.repo !== a.repo) throw new Error(`state belongs to ${state.repo}, not ${a.repo}; use a different --out`);
  const dryRun = a["dry-run"];
  // A dry run requests at most one page per list stage and writes no records, state or manifest (only the run log).
  const saveState = () => { if (!dryRun) writeJsonAtomic(stateFile, state); };
  const batchId = `batch-${runStartedAt.replace(/[-:.]/g, "").replace("T", "-").slice(0, 15)}${dryRun ? "-dry" : ""}`;
  const run = { batch_id: batchId, started_at: runStartedAt, incremental: a.incremental, authenticated: !!token };
  state.runs.push(run);

  const maxPages = a["max-pages"] ? Number(a["max-pages"]) : 0;
  const want = new Set(a.stages.split(","));
  const errFile = path.join(raw, "errors.jsonl");
  const common = { client, log, state, saveState, incremental: a.incremental, force: a.force, maxPages, runStartedAt, batchId, dryRun };
  const q = (since) => (since ? `&since=${encodeURIComponent(since)}` : "");

  let prFromIssuesEndpoint = 0;
  if (want.has("issues")) {
    await runListStage({
      ...common, name: "issues", file: path.join(raw, "issues.jsonl"),
      urlFor: (since) => `https://api.github.com/repos/${a.repo}/issues?state=all&per_page=100&sort=created&direction=asc${q(since)}`,
      extract: (it, at) => {
        if (it.pull_request) { prFromIssuesEndpoint++; return null; } // PRs come from the pulls endpoint
        return toIssueRecord(a.repo, it, at);
      },
    });
    state.stages.issues.pr_items_skipped_last_run = prFromIssuesEndpoint;
    saveState();
  }
  if (want.has("pulls")) {
    await runListStage({
      ...common, name: "pulls", file: path.join(raw, "pull_requests.jsonl"),
      // The pulls endpoint has no `since`; 43-ish PRs, so always re-list in full.
      urlFor: () => `https://api.github.com/repos/${a.repo}/pulls?state=all&per_page=100&sort=created&direction=asc`,
      extract: (it, at) => toPullRecord(a.repo, it, at),
    });
  }
  if (want.has("comments")) {
    await runListStage({
      ...common, name: "comments", file: path.join(raw, "issue_comments.jsonl"),
      urlFor: (since) => `https://api.github.com/repos/${a.repo}/issues/comments?per_page=100&sort=created&direction=asc${q(since)}`,
      extract: (c, at) => toCommentRecord(a.repo, c, at),
    });
  }
  if (want.has("pull_files") && !dryRun) {
    const pulls = readJsonl(path.join(raw, "pull_requests.jsonl"));
    await runPullFiles({ client, log, state, saveState, file: path.join(raw, "pull_files.jsonl"), errFile, repo: a.repo, pulls, maxPages });
  }

  run.finished_at = new Date().toISOString();
  run.api_requests = client.requests;
  run.retries = client.retries;
  run.rate_limit_remaining_at_end = client.rate.remaining ?? null;
  saveState();

  if (dryRun) {
    log({ event: "dry_run_done", batch_id: batchId, api_requests: client.requests });
    return;
  }

  const count = (f) => readJsonl(path.join(raw, f)).length;
  const manifest = {
    repo: a.repo,
    generated_at: run.finished_at,
    authenticated: !!token,
    counts: {
      issues: count("issues.jsonl"),
      pull_requests: count("pull_requests.jsonl"),
      issue_comments: count("issue_comments.jsonl"),
      pull_files_records: count("pull_files.jsonl"),
      errors: count("errors.jsonl"),
      pr_items_returned_by_issues_endpoint_last_run: prFromIssuesEndpoint,
    },
    stages: Object.fromEntries(Object.entries(state.stages).map(([k, v]) => [k, { complete: !!v.complete, pages: v.pages ?? null, watermark: v.watermark ?? null }])),
  };
  writeJsonAtomic(path.join(out, "collect-manifest.json"), manifest);
  log({ event: "done", ...manifest.counts, api_requests: client.requests });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(JSON.stringify({ event: "fatal", error: String(e.message || e) }));
    process.exit(1);
  });
}
