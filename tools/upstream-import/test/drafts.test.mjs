import test from "node:test";
import assert from "node:assert/strict";
import { buildDraft, displayName, slugFor, slugWithSuffix, FORBIDDEN, TEMPLATE_VERSION } from "../lib/drafts.mjs";
import { candidateFacts, repoKeyOf } from "../load.mjs";

const repoCand = (over = {}) => ({
  canonical_key: "github.com/acme/widget-server", identity_type: "github_repo",
  facts: { repo_url: "https://github.com/Acme/widget-server", repo: { name_with_owner: "Acme/widget-server", archived: false, fork: false, license: "MIT", pushed_at: "2026-01-02T03:04:05Z", checked_at: "2026-10-16T10:41:11.836Z" }, ...over },
});

test("a repository candidate gets a facts-only template draft with the real retrieval date", () => {
  const d = buildDraft(repoCand(), 1);
  assert.equal(d.title, "Acme/widget-server");
  assert.equal(d.summary_kind, "template");
  assert.equal(d.last_checked_at, "2026-10-16T10:41:11.836Z");
  assert.match(d.summary, /public GitHub repository that has been listed as a Model Context Protocol server/);
  assert.match(d.summary, /last updated on 2026-01-02/);
  assert.match(d.summary, /licence metadata reads MIT/);
  assert.equal(d.licence, "MIT");
  assert.equal(d.evidence_level, 1);
  assert.equal(d.source_links[0].kind, "repo");
  assert.equal(d.template_version, TEMPLATE_VERSION);
});

test("level 2 is typed as a server; levels 0 and 1 are 'unknown'; missing install text becomes the literal 'not documented'", () => {
  assert.equal(buildDraft(repoCand(), 2).content_type, "server");
  assert.equal(buildDraft(repoCand(), 1).content_type, "unknown");
  assert.equal(buildDraft(repoCand(), 1).install_text, "not documented");
  assert.equal(buildDraft(repoCand({ package_ids: ["npm:widget"] }), 1).install_text, "npm:widget");
  assert.equal(buildDraft(repoCand({ repo: { name_with_owner: "A/b", checked_at: "2026-10-01T00:00:00Z" } }), 1).licence, "unknown");
});

test("archived and fork repositories say so; an unlicensed repository says that no licence was found", () => {
  const d = buildDraft(repoCand({ repo: { name_with_owner: "A/b", archived: true, fork: true, license: null, checked_at: "2026-10-01T00:00:00Z" } }), 1);
  assert.match(d.summary, /archived/);
  assert.match(d.summary, /fork/);
  assert.match(d.summary, /No licence was found/);
});

test("endpoint and package candidates are declared-only drafts dated by the declaration", () => {
  const e = buildDraft({ canonical_key: "endpoint:mcp.example.org/sse", identity_type: "endpoint", facts: { endpoints: ["https://mcp.example.org/sse"], declared_at: "2026-09-03T00:00:00Z" } }, 0);
  assert.equal(e.title, "mcp.example.org/sse");
  assert.equal(e.last_checked_at, "2026-09-03T00:00:00.000Z");
  assert.match(e.summary, /declared to be a Model Context Protocol server/);
  assert.match(e.summary, /Nothing about it has been checked by this directory/);
  assert.equal(e.source_links[0].kind, "declared");
  const p = buildDraft({ canonical_key: "npm:@acme/mcp", identity_type: "package", facts: { repo_url: "https://example.org/acme", declared_at: "2026-09-03" } }, 0);
  assert.equal(p.title, "@acme/mcp");
});

test("a draft is not built without a trustworthy date or a public source link", () => {
  assert.match(buildDraft(repoCand({ repo: { name_with_owner: "A/b" } }), 1).skipped, /retrieval date/);
  assert.match(buildDraft({ canonical_key: "endpoint:x.example/y", identity_type: "endpoint", facts: { endpoints: ["https://x.example/y"] } }, 0).skipped, /declaration date/);
  assert.match(buildDraft(repoCand({ repo_url: null }), 1).skipped, /source link/);
  assert.match(buildDraft(repoCand({ repo_url: "javascript:alert(1)" }), 1).skipped, /source link/);
});

test("submitter text never enters the draft; no forbidden wording in any template output", () => {
  const hostile = repoCand({ description: "Totally VERIFIED and SAFE <script>", title: "Best trusted server", summary: "recommended!" });
  const d = buildDraft(hostile, 2);
  assert.ok(!/description|trusted|VERIFIED|script/i.test(d.summary + d.title));
  for (const lvl of [0, 1, 2]) for (const c of [repoCand(), repoCand({ repo: { name_with_owner: "A/b", archived: true, fork: true, license: null, checked_at: "2026-10-01T00:00:00Z" } })]) {
    const x = buildDraft(c, lvl);
    assert.ok(!FORBIDDEN.test(x.summary), x.summary);
  }
});

test("a project's own identifier may contain a forbidden word; the directory's wording may not", () => {
  const d = buildDraft(repoCand({ repo: { name_with_owner: "Acme/secure-notes-mcp", checked_at: "2026-10-01T00:00:00Z" } }), 1);
  assert.equal(d.title, "Acme/secure-notes-mcp");
  assert.ok(!FORBIDDEN.test(d.summary.split(d.title).join("")));
});

test("names and slugs", () => {
  assert.equal(displayName({ canonical_key: "github.com/o/r/sub", facts: {} }), "o/r/sub");
  assert.equal(slugFor("Acme/Widget_Server v2!"), "acme-widget-server-v2");
  assert.equal(slugFor("///"), "entry");
  assert.ok(slugFor("a".repeat(300)).length <= 80);
  assert.equal(slugWithSuffix("Acme/widget", "ABCDEF123456"), "acme-widget-abcdef1");
  assert.match(slugFor("ünïcode/söme"), /^[a-z0-9-]+$/);
});

test("loader facts carry the retrieval date, pushed date and licence metadata from enrichment", () => {
  const p = { canonical_key: "github.com/acme/widget-server", repo: { name_with_owner: "Acme/widget-server", license: null }, last_seen: "2026-09-01T00:00:00Z" };
  const f = candidateFacts(p, { checked_at: "2026-10-16T10:00:00Z", license_spdx: "Apache-2.0", pushed_at: "2026-02-02T00:00:00Z" });
  assert.equal(f.repo.checked_at, "2026-10-16T10:00:00Z");
  assert.equal(f.repo.license, "Apache-2.0");
  assert.equal(f.repo.pushed_at, "2026-02-02T00:00:00Z");
  assert.equal(f.declared_at, "2026-09-01T00:00:00Z");
  assert.equal(candidateFacts(p).repo.checked_at, null);
  assert.equal(repoKeyOf("github.com/o/r/sub/dir"), "github.com/o/r");
  assert.equal(repoKeyOf("endpoint:x.example/y"), null);
});
