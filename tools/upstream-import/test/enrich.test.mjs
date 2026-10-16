import test from "node:test";
import assert from "node:assert/strict";
import { scanManifests } from "../enrich.mjs";

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
