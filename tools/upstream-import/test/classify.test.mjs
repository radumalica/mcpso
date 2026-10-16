import test from "node:test";
import assert from "node:assert/strict";
import { classifyProject, registryMatches, buildRegistryIndex, applyRemovalHold } from "../classify.mjs";

const NOREG = { viaPackageOrEndpoint: [], viaRepoOwnerNamespace: [], repoClaimOnly: [] };
const ctx = { collectedAt: "2026-10-16T00:00:00Z", bulkAuthors: new Set() };
const proj = (key, over = {}) => ({
  project_id: "p_x", canonical_key: key, identity_type: key.startsWith("github.com/") ? "github_repo" : "endpoint",
  merged_claims: { name: "Thing", description: "A useful MCP server for things and stuff", package_ids: ["npm:thing"], install_command: null, endpoints: [], license: "MIT", hosting: "local", restricted_endpoints_claimed: [], ...over.claims },
  ambiguity_flags: [], security_flags: [], authors: ["a"], upstream_states: ["issue:open"], quality_flags: [], submitted_by_repo_owner: true, ...over.top,
});
const repo = (over = {}) => ({
  resolved: true, requested: "o/r", name_with_owner: "o/r", renamed: false, archived: false, fork: false, empty: false, template: false, license_spdx: "MIT",
  pushed_at: "2026-09-01T00:00:00Z", mcp_topics: [], sdk_evidence: [], readme_bytes: 3000, readme_mcp_mention: null, description_mentions_mcp: false, description: "d",
  server_wording: [], server_wording_subpath: [], subpath_readme_bytes: null, subpath_readme_mcp_mention: null, subpath_exists: null, evaluated_subpath: null, ...over,
});
const cls = (p, info, reg = NOREG) => classifyProject(p, info, reg, ctx);

test("server.json alone is sufficient (registry-manifest signal)", () => {
  const r = cls(proj("github.com/o/r"), repo({ sdk_evidence: [{ scope: "root", signal: "server.json:registry-manifest" }] }));
  assert.equal(r.category, "eligible");
});

test("SDK dependency without server wording is only weak (N1); with wording it is eligible", () => {
  const sdk = [{ scope: "root", signal: "npm-dep:@modelcontextprotocol/sdk" }];
  const a = cls(proj("github.com/o/r"), repo({ sdk_evidence: sdk }));
  assert.equal(a.category, "needs_review"); assert.equal(a.reasons[0].rule, "N1");
  const b = cls(proj("github.com/o/r"), repo({ sdk_evidence: sdk, server_wording: ["readme"] }));
  assert.equal(b.category, "eligible");
});

test("subpath projects use ONLY subpath evidence and subpath wording", () => {
  const p = proj("github.com/o/r/src/a");
  // root has strong evidence; the subpath has none -> must not be eligible
  const rootOnly = repo({ evaluated_subpath: "src/a", subpath_exists: true, sdk_evidence: [{ scope: "root", signal: "server.json:registry-manifest" }], server_wording: ["readme"] });
  assert.notEqual(cls(p, rootOnly).category, "eligible");
  const subOk = repo({ evaluated_subpath: "src/a", subpath_exists: true, sdk_evidence: [{ scope: "subpath", signal: "npm-dep:@modelcontextprotocol/sdk" }], server_wording_subpath: ["subpath-readme"], subpath_readme_bytes: 900 });
  assert.equal(cls(p, subOk).category, "eligible");
  const missing = repo({ evaluated_subpath: "src/a", subpath_exists: false, sdk_evidence: [{ scope: "subpath", signal: "server.json:registry-manifest" }] });
  assert.equal(cls(p, missing).reasons[0].rule, "N5");
});

test("official registry: repo-URL-only claim is weak; owner namespace and package/endpoint matches count", () => {
  const entries = [
    { name: "io.github.o/r", repository_key: "github.com/o/r", remotes: [], packages: [] },
    { name: "io.github.someone/other", repository_key: "github.com/o/r2", remotes: [], packages: [] },
    { name: "com.example/x", repository_key: null, remotes: [{ key: "endpoint:mcp.example.com/mcp" }], packages: [{ registry: "npm", id: "Thing-Pkg" }] },
  ];
  const idx = buildRegistryIndex(entries);
  assert.deepEqual(registryMatches(proj("github.com/o/r"), idx).viaRepoOwnerNamespace, ["io.github.o/r"]);
  assert.deepEqual(registryMatches(proj("github.com/o/r2"), idx).repoClaimOnly, ["io.github.someone/other"]);
  const m = registryMatches(proj("github.com/q/z", { claims: { endpoints: ["https://mcp.example.com/mcp/"], package_ids: ["npm:thing-pkg"] } }), idx);
  assert.deepEqual(m.viaPackageOrEndpoint, ["com.example/x"]);
});

test("unresolved repo cannot become eligible through a repo-URL registry claim (N2), only via package/endpoint (E1b)", () => {
  const unresolved = { resolved: false, reason: "not_found_or_private" };
  const repoClaim = { ...NOREG, repoClaimOnly: ["io.github.x/y"] };
  assert.equal(cls(proj("github.com/o/r"), unresolved, repoClaim).reasons[0].rule, "N2");
  const viaOwner = { ...NOREG, viaRepoOwnerNamespace: ["io.github.o/r"] };
  assert.equal(cls(proj("github.com/o/r"), unresolved, viaOwner).reasons[0].rule, "N2");
  const viaPkg = { ...NOREG, viaPackageOrEndpoint: ["com.example/x"] };
  const r = cls(proj("github.com/o/r"), unresolved, viaPkg);
  assert.equal(r.category, "eligible"); assert.equal(r.reasons[0].rule, "E1b");
});

test("fork, owner transfer, blocking ambiguity, thin metadata -> needs review; same-owner rename stays eligible", () => {
  const ok = { sdk_evidence: [{ scope: "root", signal: "server.json:registry-manifest" }] };
  assert.equal(cls(proj("github.com/o/r"), repo({ ...ok, fork: true, fork_parent: "x/y" })).reasons[0].rule, "N4");
  assert.equal(cls(proj("github.com/o/r"), repo({ ...ok, renamed: true, requested: "old/r", name_with_owner: "new/r" })).reasons[0].rule, "N9");
  assert.equal(cls(proj("github.com/o/r"), repo({ ...ok, renamed: true, requested: "o/old", name_with_owner: "o/r" })).category, "eligible");
  assert.equal(cls(proj("github.com/o/r", { top: { ambiguity_flags: [{ code: "shared_package_across_repos", detail: "npm:x also claimed by y" }] } }), repo(ok)).reasons[0].rule, "N6");
  assert.equal(cls(proj("github.com/o/r", { claims: { description: "short", package_ids: [] } }), repo({ ...ok, readme_bytes: 10, description: null })).reasons[0].rule, "N7");
});

test("ineligible only for infrastructure, empty/template, or no MCP signal at all (root projects)", () => {
  assert.equal(cls(proj("github.com/chatmcp/mcpso"), repo()).reasons[0].rule, "I1");
  assert.equal(cls(proj("github.com/o/r", { claims: { package_ids: [], endpoints: [] } }), repo({ empty: true })).reasons[0].rule, "I2");
  const none = cls(proj("github.com/o/r", { claims: { package_ids: [], endpoints: [] } }), repo({ name_with_owner: "o/garden-notes" }));
  assert.equal(none.reasons[0].rule, "I3");
  // same facts but claimed as a monorepo subpath: never I3 (the root README says nothing about the subpath)
  const sub = cls(proj("github.com/o/r/pkg", { claims: { package_ids: [], endpoints: [] } }), repo({ name_with_owner: "o/garden-notes", evaluated_subpath: "pkg", subpath_exists: true }));
  assert.notEqual(sub.reasons[0].rule, "I3");
});

test("security concern is independent of category", () => {
  const r = cls(proj("github.com/o/r", { top: { security_flags: [{ code: "pipe_to_shell_install", detail: "curl | sh" }] } }), repo({ sdk_evidence: [{ scope: "root", signal: "server.json:registry-manifest" }] }));
  assert.equal(r.category, "eligible"); assert.equal(r.security_concern, true); assert.equal(r.import_ready, false);
});

test("projects with a pending removal request are never import-ready, and inputs are not mutated", () => {
  const rows = [{ project_id: "a", import_ready: true, category: "eligible", quality_indicators: [] }, { project_id: "b", import_ready: true, category: "eligible", quality_indicators: [] }];
  const out = applyRemovalHold(rows, new Set(["a"]));
  assert.equal(out[0].import_ready, false); assert.equal(out[0].category, "eligible");
  assert.deepEqual(out[0].quality_indicators, ["removal_request_pending"]);
  assert.equal(out[1].import_ready, true);
  assert.equal(rows[0].import_ready, true); assert.deepEqual(rows[0].quality_indicators, []);
});
