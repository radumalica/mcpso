import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, parseListing, safeExternalUrl, parsePage, pageCount, catalogueHref, hostOf, PAGE_SIZE } from "../../lib/listing.ts";
import { EVIDENCE_WORDING, EVIDENCE_LABEL, FORBIDDEN_WORDS, evidenceWording, toEvidenceLevel, formatDate } from "../../lib/evidence.ts";
import { EVIDENCE_WORDING as POLICY_WORDING } from "../../tools/upstream-import/lib/gates.mjs";

const row = (over = {}) => ({
  slug: "example-server", title: "Example", summary: "Reviewer-written summary.", evidence_level: 1,
  evidence_checked_at: "2026-10-01T00:00:00Z", published_at: "2026-10-02T00:00:00Z",
  source_links: [{ url: "https://github.com/o/r", kind: "repo", retrieved_at: "2026-10-01" }],
  facts: { repo_url: "https://github.com/o/r", license_claimed: "MIT", transports: ["stdio"], repo: { name_with_owner: "o/r", archived: false, fork: false } },
  ...over,
});

test("a valid row becomes a listing", () => {
  const l = parseListing(row());
  assert.equal(l.slug, "example-server");
  assert.equal(l.evidenceLevel, 1);
  assert.equal(l.facts.licence, "MIT");
  assert.equal(l.facts.repoName, "o/r");
  assert.equal(l.sourceLinks.length, 1);
});

test("rows that cannot be shown safely are dropped", () => {
  for (const bad of [null, "x", {}, row({ slug: "Bad Slug" }), row({ slug: "../etc" }), row({ title: "  " }), row({ summary: null }), row({ slug: "a".repeat(101) })]) {
    assert.equal(parseListing(bad), null);
  }
});

test("untrusted facts and links are coerced; dangerous URLs never survive", () => {
  const l = parseListing(row({
    facts: { repo_url: "javascript:alert(1)", homepage: "data:text/html,x", endpoints: ["ok", 5, null, { a: 1 }], transports: "stdio", repo: "nope" },
    source_links: [{ url: "javascript:alert(1)" }, { url: "https://user:pw@evil.example/" }, { url: "https://ok.example/p", kind: "registry" }, "x", null],
    evidence_level: 99,
  }));
  assert.equal(l.facts.repoUrl, null);
  assert.equal(l.facts.homepage, null);
  assert.deepEqual(l.facts.endpoints, ["ok"]);
  assert.deepEqual(l.facts.transports, []);
  assert.deepEqual(l.sourceLinks.map((s) => s.url), ["https://ok.example/p"]);
  assert.equal(l.evidenceLevel, 0, "unknown level is treated as the weakest");
});

test("safeExternalUrl accepts only http(s) without credentials", () => {
  assert.equal(safeExternalUrl("https://example.org/a?b=1"), "https://example.org/a?b=1");
  for (const bad of ["ftp://x", "//x", "javascript:1", "https://u:p@x.example", "", null, 5, "not a url"]) assert.equal(safeExternalUrl(bad), null);
  assert.equal(hostOf("https://sub.example.org/x"), "sub.example.org");
});

test("page parsing and counting are bounded", () => {
  assert.equal(parsePage("3"), 3);
  for (const bad of [undefined, "0", "-1", "abc", "1e9", "1234567", ["2", "3"][1] === "3" ? "x" : ""]) assert.equal(parsePage(bad), 1);
  assert.equal(parsePage(["4", "9"]), 4);
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(PAGE_SIZE), 1);
  assert.equal(pageCount(PAGE_SIZE + 1), 2);
});

test("catalogue links are canonical", () => {
  assert.equal(catalogueHref({}), "/");
  assert.equal(catalogueHref({ page: 1 }), "/");
  assert.equal(catalogueHref({ q: "a b", page: 2 }), "/?q=a+b&page=2");
  assert.equal(catalogueHref({ declared: true }), "/?declared=1");
});

test("the public evidence wording is identical to the policy source in the importer", () => {
  for (const level of [0, 1, 2]) assert.equal(EVIDENCE_WORDING[level], POLICY_WORDING[level], `level ${level}`);
});

test("wording fills in the date, never says verified/safe/trusted, and names the limits", () => {
  assert.match(evidenceWording(1, "2026-10-01T10:00:00Z"), /checked on 2026-10-01 /);
  assert.match(evidenceWording(0, null), /an unknown date/);
  for (const level of [0, 1, 2]) {
    const text = (EVIDENCE_WORDING[level] + EVIDENCE_LABEL[level]).toLowerCase();
    for (const w of FORBIDDEN_WORDS) assert.ok(!new RegExp(`\\b${w}\\b`).test(text.replace("not been tested or security-reviewed", "")), `${w} in level ${level}`);
  }
  assert.equal(toEvidenceLevel("2"), 0);
  assert.equal(toEvidenceLevel(2), 2);
  assert.equal(formatDate("garbage"), "an unknown date");
});

test("cleanText removes bidirectional overrides, zero-width and control characters and flattens line breaks", () => {
  assert.equal(cleanText("a\u202Eb\u200Bc\u2066d\u2069e\u0007f"), "abcdef");
  assert.equal(cleanText("line one\r\nline two\tend"), "line one line two end");
  assert.equal(cleanText("  padded  "), "padded");
});
