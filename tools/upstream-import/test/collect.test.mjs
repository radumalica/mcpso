// Collector resume / idempotence / incremental behaviour against a fake in-memory GitHub API (no network, no token).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../collect.mjs";
import { readJsonl, readJson } from "../lib/store.mjs";

const REPO = "example/source";
const API = "https://api.github.com";

function makeApi() {
  const state = {
    issues: [1, 2, 3, 4, 5].map((n) => ({
      id: 1000 + n, number: n, html_url: `https://github.com/${REPO}/issues/${n}`, user: { login: `u${n}`, id: n, type: "User" },
      author_association: "NONE", created_at: `2025-01-0${n}T00:00:00Z`, updated_at: `2025-01-0${n}T00:00:00Z`,
      state: "open", comments: 0, labels: [], title: `Add server ${n}`, body: `https://example.org/repo${n}`,
      ...(n === 3 ? { pull_request: { url: "x" } } : {}),
    })),
    pulls: [], comments: [
      { id: 5001, issue_url: `${API}/repos/${REPO}/issues/1`, html_url: "https://github.com/c/1", user: { login: "u1", id: 1, type: "User" }, created_at: "2025-02-01T00:00:00Z", updated_at: "2025-02-01T00:00:00Z", body: "thanks" },
    ],
  };
  const requests = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    requests.push(u);
    const per = 2; // small pages to force several Link hops
    const page = Number(u.searchParams.get("page") || 1);
    const send = (all) => {
      const since = u.searchParams.get("since");
      const items = all.filter((i) => !since || i.updated_at >= since);
      const slice = items.slice((page - 1) * per, page * per);
      const headers = { "content-type": "application/json", "x-ratelimit-remaining": "4000", "x-ratelimit-reset": "9999999999" };
      if (page * per < items.length) {
        const n = new URL(u); n.searchParams.set("page", String(page + 1));
        headers.link = `<${n.toString()}>; rel="next"`;
      }
      return new Response(JSON.stringify(slice), { status: 200, headers });
    };
    if (u.pathname === `/repos/${REPO}/issues`) return send(state.issues);
    if (u.pathname === `/repos/${REPO}/pulls`) return send(state.pulls);
    if (u.pathname === `/repos/${REPO}/issues/comments`) return send(state.comments);
    return new Response("{}", { status: 404 });
  };
  return { state, requests, fetchImpl };
}

function tmpOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "collect-test-"));
}
const run = async (out, api, extra = []) => {
  const saved = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  try {
    await main(["--out", out, "--repo", REPO, "--quiet", "--stages", "issues,pulls,comments", ...extra], {
      clientOptions: { fetchImpl: api.fetchImpl, sleep: async () => {}, maxRetries: 1 },
    });
  } finally {
    if (saved !== undefined) process.env.GITHUB_TOKEN = saved;
  }
};
const ids = (out, f) => readJsonl(path.join(out, "raw", f)).map((r) => r.source_id).sort((a, b) => a - b);

test("full run follows pagination, excludes PR items from issues, and writes a manifest", async () => {
  const api = makeApi(); const out = tmpOut();
  await run(out, api);
  assert.deepEqual(ids(out, "issues.jsonl"), [1001, 1002, 1004, 1005]); // #3 is a PR item
  assert.deepEqual(ids(out, "issue_comments.jsonl"), [5001]);
  const manifest = readJson(path.join(out, "collect-manifest.json"));
  assert.equal(manifest.counts.issues, 4);
  assert.equal(manifest.counts.pr_items_returned_by_issues_endpoint_last_run, 1);
  assert.equal(manifest.stages.issues.complete, true);
});

test("every collected record carries provenance and a collection timestamp", async () => {
  const api = makeApi(); const out = tmpOut();
  await run(out, api);
  for (const r of readJsonl(path.join(out, "raw", "issues.jsonl"))) {
    assert.equal(r.source_repo, REPO);
    assert.match(r.source_url, /^https:\/\/github\.com\//);
    assert.ok(r.source_id && r.source_number && r.created_at && r.collected_at);
  }
});

test("re-running a completed collection makes no list requests and changes nothing", async () => {
  const api = makeApi(); const out = tmpOut();
  await run(out, api);
  const before = fs.readFileSync(path.join(out, "raw", "issues.jsonl"), "utf8");
  api.requests.length = 0;
  await run(out, api);
  assert.equal(api.requests.length, 0);
  assert.equal(fs.readFileSync(path.join(out, "raw", "issues.jsonl"), "utf8"), before);
});

test("an interrupted run resumes from the checkpoint without duplicates or gaps", async () => {
  const api = makeApi(); const out = tmpOut();
  await run(out, api, ["--max-pages", "1"]);
  assert.equal(readJson(path.join(out, "state", "collect.json")).stages.issues.complete, false);
  assert.ok(ids(out, "issues.jsonl").length < 4);
  await run(out, api); // resume
  assert.deepEqual(ids(out, "issues.jsonl"), [1001, 1002, 1004, 1005]);
  assert.equal(new Set(ids(out, "issues.jsonl")).size, ids(out, "issues.jsonl").length);
});

test("an incremental run requests only changes since the watermark and replaces edited records", async () => {
  const api = makeApi(); const out = tmpOut();
  await run(out, api);
  api.state.issues[0].body = "edited body"; api.state.issues[0].updated_at = "2099-01-01T00:00:00Z";
  api.state.issues.push({ ...api.state.issues[3], id: 1006, number: 6, title: "Add server 6", updated_at: "2099-01-02T00:00:00Z", created_at: "2099-01-02T00:00:00Z" });
  api.requests.length = 0;
  await run(out, api, ["--incremental"]);
  assert.ok(api.requests.some((u) => u.searchParams.has("since")));
  const rows = readJsonl(path.join(out, "raw", "issues.jsonl"));
  assert.equal(rows.length, 5);
  assert.equal(rows.find((r) => r.source_id === 1001).body, "edited body");
  assert.ok(rows.some((r) => r.source_id === 1006));
});

test("a state file belonging to another repository is refused", async () => {
  const api = makeApi(); const out = tmpOut();
  await run(out, api);
  await assert.rejects(
    main(["--out", out, "--repo", "other/repo", "--quiet", "--stages", "issues"], { clientOptions: { fetchImpl: api.fetchImpl, sleep: async () => {} } }),
    /state belongs to/,
  );
});
