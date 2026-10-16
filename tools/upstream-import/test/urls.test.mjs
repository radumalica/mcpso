import test from "node:test";
import assert from "node:assert/strict";
import { canonicalGithub, classifyUrl, extractUrls, isRestrictedHost, endpointKey, looksLikeMcpEndpoint } from "../lib/urls.mjs";

test("github URL variants collapse to one key", () => {
  const variants = [
    "https://github.com/Foo/Bar",
    "http://github.com/foo/bar/",
    "https://www.github.com/foo/BAR.git",
    "https://github.com/foo/bar/issues/12",
    "https://github.com/foo/bar?tab=readme-ov-file#install",
    "https://github.com/foo/bar/releases",
    "https://github.com/foo/bar/blob/main/README.md",
  ];
  for (const v of variants) assert.equal(canonicalGithub(v).key, "github.com/foo/bar", v);
});

test("monorepo subpaths stay distinct", () => {
  assert.equal(canonicalGithub("https://github.com/modelcontextprotocol/servers/tree/main/src/git").key, "github.com/modelcontextprotocol/servers/src/git");
  assert.equal(canonicalGithub("https://github.com/modelcontextprotocol/servers/tree/main/src/fetch/").key, "github.com/modelcontextprotocol/servers/src/fetch");
  assert.equal(canonicalGithub("https://github.com/topoteretes/cognee/tree/dev/cognee-mcp").key, "github.com/topoteretes/cognee/cognee-mcp");
  assert.equal(canonicalGithub("https://github.com/o/r/blob/main/src/x/README.md").key, "github.com/o/r/src/x");
  assert.notEqual(canonicalGithub("https://github.com/o/r/tree/main/a").key, canonicalGithub("https://github.com/o/r/tree/main/b").key);
});

test("tree URL without a path is the repo itself", () => {
  assert.equal(canonicalGithub("https://github.com/o/r/tree/main").key, "github.com/o/r");
});

test("non-repo GitHub URLs are rejected, other hosts return null", () => {
  assert.equal(canonicalGithub("https://github.com/someuser").kind, "not_repo");
  assert.equal(canonicalGithub("https://github.com/orgs/foo/repositories").kind, "not_repo");
  assert.equal(canonicalGithub("https://github.com/").kind, "not_repo");
  assert.equal(canonicalGithub("https://gist.github.com/a/b").kind, "not_repo");
  assert.equal(canonicalGithub("https://example.com/foo/bar"), null);
  // look-alike hosts must not be accepted (cf. startsWith("https://github.com") in services/project.ts)
  assert.equal(canonicalGithub("https://github.com.evil.example/foo/bar"), null);
  assert.equal(canonicalGithub("https://evilgithub.com/foo/bar"), null);
  assert.equal(canonicalGithub("javascript:alert(1)"), null);
});

test("raw.githubusercontent maps to repo", () => {
  assert.equal(canonicalGithub("https://raw.githubusercontent.com/Foo/Bar/main/README.md").key, "github.com/foo/bar");
});

test("extractUrls trims punctuation and markdown", () => {
  const t = "See [repo](https://github.com/a/b), docs: https://x.dev/docs. Also `https://npmjs.com/package/@s/p`.";
  assert.deepEqual(extractUrls(t), ["https://github.com/a/b", "https://x.dev/docs", "https://npmjs.com/package/@s/p"]);
});

test("classifyUrl", () => {
  assert.equal(classifyUrl("https://www.npmjs.com/package/@scope/pkg").id, "npm:@scope/pkg");
  assert.equal(classifyUrl("https://pypi.org/project/My_Pkg/").id, "pypi:my-pkg");
  assert.equal(classifyUrl("https://t.co/abc").type, "shortener");
  assert.equal(classifyUrl("https://smithery.ai/server/x").type, "directory_listing");
});

test("restricted hosts", () => {
  for (const h of ["localhost", "127.0.0.1", "169.254.169.254", "10.0.0.5", "metadata.google.internal", "foo.local", "[::1]", "2130706433"]) assert.ok(isRestrictedHost(h), h);
  for (const h of ["example.com", "api.github.com", "mcp.example.dev"]) assert.ok(!isRestrictedHost(h), h);
});

test("endpoint helpers", () => {
  assert.ok(looksLikeMcpEndpoint("https://x.dev/mcp"));
  assert.ok(looksLikeMcpEndpoint("https://mcp.x.dev/"));
  assert.ok(!looksLikeMcpEndpoint("https://x.dev/blog"));
  assert.equal(endpointKey("https://X.dev/MCP/?a=1"), "endpoint:x.dev/mcp");
});
