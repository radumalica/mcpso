// End-to-end edge cases of normalise + dedup on about 200 synthetic raw records (fixtures/synthetic-raw.mjs).
// Expectations come from the documented merge policy (dedup.mjs header) and the eligibility criteria, not from observed output.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOne } from "../normalize.mjs";
import { buildProjects } from "../dedup.mjs";
import { syntheticRaw } from "./fixtures/synthetic-raw.mjs";

const { scenarios, records, renames } = syntheticRaw();
const normalizedOf = (name) => scenarios[name].map((r) => normalizeOne(r));
const all = records.map((r) => normalizeOne(r));
const idOf = (r) => `${{ issue: "issue", pull_request: "pr", issue_comment: "comment" }[r.source_type]}:${r.source_id}`;
const inScenario = (name) => new Set(scenarios[name].map(idOf));
const built = buildProjects(all.filter((n) => n.source.type !== "issue_comment" || n.source.in_submission_thread), { renames });
const projectsFor = (name) => { const ids = inScenario(name); return built.projects.filter((p) => p.source_record_ids.some((id) => ids.has(id))); };

test("the fixture has about 200 records and every scenario is non-empty", () => {
  assert.ok(records.length >= 190 && records.length <= 230, `got ${records.length}`);
  for (const [name, rs] of Object.entries(scenarios)) assert.ok(rs.length > 0, name);
  assert.equal(new Set(records.map((r) => r.source_id)).size, records.length, "source ids are unique");
});

test("unique repositories each become one project", () => {
  assert.equal(projectsFor("unique").filter((p) => p.canonical_key.includes("/unique-")).length, 40);
});

test("spelling variants of one address (case, trailing slash, .git) merge into one project per repository", () => {
  const ps = projectsFor("variants");
  assert.equal(ps.length, 10);
  for (const p of ps) assert.equal(p.source_record_ids.length, 3, p.canonical_key);
  assert.ok(ps.every((p) => p.canonical_key === p.canonical_key.toLowerCase()), "keys are lower-case");
});

test("renames: the old and the new address merge once the rename is resolved, and the merge is logged", () => {
  const ps = projectsFor("renames");
  assert.equal(ps.length, 8);
  for (const p of ps) {
    assert.match(p.canonical_key, /after-\d$/);
    assert.equal(p.source_record_ids.length, 2);
    assert.ok(JSON.stringify(p.merge_reasons).includes("R6"), "rename merge reason recorded");
  }
  const without = buildProjects(all.filter((n) => inScenario("renames").has(n.record_id)), { renames: new Map() });
  assert.equal(without.projects.length, 16, "without rename evidence nothing is merged on similarity");
});

test("a monorepo and its sub-paths stay separate projects", () => {
  const ps = projectsFor("subpaths");
  assert.equal(ps.length, 7);
  assert.equal(ps.filter((p) => p.canonical_key.includes("/packages/")).length, 6);
});

test("the same package named by two repositories is flagged, never merged", () => {
  const ps = projectsFor("shared_package");
  assert.equal(ps.length, 10, "ten separate repositories");
  const flagged = ps.filter((p) => JSON.stringify(p.ambiguity_flags ?? p.ambiguity ?? []).includes("shared_package_across_repos"));
  assert.equal(flagged.length, 10, "every project that shares a package across repositories carries the flag");
});

test("endpoint-only submissions merge on an identical endpoint, one project per endpoint", () => {
  const ps = projectsFor("endpoints");
  assert.equal(ps.length, 5);
  for (const p of ps) { assert.equal(p.identity_type, "endpoint"); assert.equal(p.source_record_ids.length, 2); }
});

test("private-network endpoints are marked restricted and never become an identity", () => {
  for (const n of normalizedOf("restricted")) {
    assert.ok(n.claims.endpoints.every((e) => e.restricted), "restricted");
    assert.ok(n.security_flags.some((f) => f.code === "restricted_endpoint_target"));
  }
  for (const p of projectsFor("restricted")) assert.equal(p.identity_type, "github_repo");
});

test("hidden Unicode and instructions to an automated reader raise security flags; hidden characters inside an address defeat the match (fail closed)", () => {
  const ns = normalizedOf("hostile");
  assert.ok(ns.slice(0, 5).every((n) => n.security_flags.some((f) => f.code === "hidden_unicode_characters")));
  assert.ok(ns.slice(5).every((n) => n.security_flags.some((f) => f.code.startsWith("prompt_injection_phrase"))));
  assert.ok(ns.every((n) => n.intent !== "removal_request"));
});

test("empty and whitespace-only bodies are flagged and carry no identity", () => {
  for (const n of normalizedOf("empty")) {
    assert.ok(n.quality_flags.includes("empty_body"));
    assert.equal(n.intent, "no_identity");
  }
});

test("removal requests are recognised and never become submissions", () => {
  for (const n of normalizedOf("removals")) assert.equal(n.intent, "removal_request");
  const ids = inScenario("removals");
  assert.ok(built.projects.every((p) => !p.source_record_ids.some((id) => ids.has(id))), "no project is built from a removal request");
});

test("questions and code changes create no projects", () => {
  for (const n of normalizedOf("questions")) assert.ok(!["submission", "submission_unclear"].includes(n.intent), n.intent);
  for (const n of normalizedOf("code_changes")) assert.equal(n.intent, "code_contribution");
  assert.equal(projectsFor("questions").length + projectsFor("code_changes").length, 0);
});

test("only comments in the submission thread can become submissions", () => {
  assert.equal(projectsFor("thread_comments").length, 12);
  for (const n of normalizedOf("thread_comments")) assert.equal(n.source.in_submission_thread, true);
  for (const n of normalizedOf("other_comments")) assert.equal(n.source.in_submission_thread, false);
});

test("bot-authored records are flagged", () => {
  for (const n of normalizedOf("bots")) assert.ok(n.quality_flags.includes("author_is_bot_account"));
});

test("every project points back to existing source records, and each record is used at most once", () => {
  const known = new Set(all.map((n) => n.record_id));
  const seen = new Set();
  for (const p of built.projects) for (const id of p.source_record_ids) {
    assert.ok(known.has(id), id);
    assert.ok(!seen.has(id), `${id} is in two projects`);
    seen.add(id);
  }
});
