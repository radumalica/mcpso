import test from "node:test";
import assert from "node:assert/strict";
import { scanManifests, targetFromProject, safeSubpath } from "../enrich.mjs";

const proj = (key, repoUrl) => ({ canonical_key: key, merged_claims: { repo_url: repoUrl } });

test("targets keep the submitter's case for owner, repo and subpath (git paths are case-sensitive)", () => {
  const t = targetFromProject(proj("github.com/acme/mcp-fleet/servers/myserver", "https://github.com/Acme/MCP-Fleet/tree/HEAD/servers/MyServer"));
  assert.deepEqual(t, { requested_key: "github.com/acme/mcp-fleet/servers/myserver", owner: "Acme", repo: "MCP-Fleet", subpath: "servers/MyServer" });
});

test("sibling subpath projects get distinct targets; repo-level project has none", () => {
  const a = targetFromProject(proj("github.com/o/r/a", "https://github.com/o/r/tree/HEAD/a"));
  const b = targetFromProject(proj("github.com/o/r/b", "https://github.com/o/r/tree/HEAD/b"));
  const root = targetFromProject(proj("github.com/o/r", "https://github.com/o/r"));
  assert.notEqual(a.requested_key, b.requested_key);
  assert.equal(a.subpath, "a"); assert.equal(b.subpath, "b"); assert.equal(root.subpath, null);
});

test("URL that disagrees with the canonical key is ignored; unsafe subpaths are dropped", () => {
  assert.equal(targetFromProject(proj("github.com/o/r", "https://github.com/other/r")).owner, "o");
  assert.equal(safeSubpath("src/ok-1.2"), "src/ok-1.2");
  for (const bad of ['a"b', "a\\b", "../x", "a//b", "a b", "", null]) assert.equal(safeSubpath(bad), null, String(bad));
});

test("package.json: SDK dependency and mcpName count; unrelated 'mcp' key does not", () => {
  assert.deepEqual(scanManifests(JSON.stringify({ dependencies: { "@modelcontextprotocol/sdk": "^1" } }), "package.json"), ["npm-dep:@modelcontextprotocol/sdk"]);
  assert.deepEqual(scanManifests(JSON.stringify({ mcpName: "io.example/b" }), "package.json"), ["package.json:mcpName"]);
  assert.deepEqual(scanManifests(JSON.stringify({ mcp: { anything: 1 }, dependencies: { react: "1" } }), "package.json"), []);
});

test("python manifests", () => {
  assert.equal(scanManifests('dependencies = ["mcp[cli]>=1.2"]', "pyproject.toml").length, 1);
  assert.equal(scanManifests("fastmcp==2.0\nrequests", "requirements.txt").length, 1);
  assert.equal(scanManifests('dependencies = ["requests", "mcpx-unrelated-lib"]', "pyproject.toml").length, 0);
});

test("pyproject: only dependency sections count (not keywords, name, scripts)", () => {
  const notDeps = `[project]\nname = "mcp"\nkeywords = ["mcp", "server"]\n[project.scripts]\nmcp = "pkg:main"\ndependencies = ["requests>=2"]\n`;
  assert.equal(scanManifests(notDeps, "pyproject.toml").length, 0);
  const multi = `[project]\nname = "x"\ndependencies = [\n  "httpx",\n  "mcp[cli]>=1.2.0",  # sdk\n]\n`;
  assert.equal(scanManifests(multi, "pyproject.toml").length, 1);
  const poetry = `[tool.poetry.dependencies]\npython = "^3.10"\nfastmcp = "^2.0"\n`;
  assert.equal(scanManifests(poetry, "pyproject.toml").length, 1);
  const groups = `[dependency-groups]\ndev = ["pytest", "mcp>=1"]\n`;
  assert.equal(scanManifests(groups, "pyproject.toml").length, 1);
  assert.equal(scanManifests("# mcp\nrequests\n", "requirements.txt").length, 0);
});

test("go / rust / jvm", () => {
  assert.equal(scanManifests("require example.invalid/x v1\nrequire github.com/mark3labs/mcp-go v0.1.0", "go.mod").length, 1);
  assert.equal(scanManifests('[dependencies]\nrmcp = "0.1"', "Cargo.toml").length, 1);
  assert.equal(scanManifests("<groupId>io.modelcontextprotocol.sdk</groupId>", "pom.xml").length, 1);
});

test("server.json needs registry shape; garbage is no evidence", () => {
  assert.equal(scanManifests(JSON.stringify({ $schema: "https://static.modelcontextprotocol.io/schemas/x/server.schema.json", name: "a/b" }), "server.json").length, 1);
  assert.equal(scanManifests(JSON.stringify({ name: "thing", packages: [] }), "server.json").length, 0); // no namespace form
  assert.equal(scanManifests(JSON.stringify({ name: "io.example/thing", packages: [{}] }), "server.json").length, 1);
  assert.equal(scanManifests(JSON.stringify({ name: "thing" }), "server.json").length, 0);
  assert.equal(scanManifests("{not json", "server.json").length, 0);
  assert.equal(scanManifests(null, "package.json").length, 0);
});
