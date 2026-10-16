// Regression guard for audit finding on PostgREST filter injection through the `?q=` search parameter.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sanitizeSearchTerm, MAX_SEARCH_TERM_LENGTH } from "../../utils/search-term.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("plain keywords are kept", () => {
  assert.equal(sanitizeSearchTerm("  postgres   server "), "postgres server");
  assert.equal(sanitizeSearchTerm("café"), "café");
});

test("filter syntax cannot be injected", () => {
  const evil = 'x%,status.eq.deleted),or(id.gt.0,name.ilike.%a';
  const out = sanitizeSearchTerm(evil);
  assert.ok(!/[,()%"\\*]/.test(out), out);
});

test("wildcards, control characters and non-strings are neutralised", () => {
  assert.equal(sanitizeSearchTerm("%%%___***"), "");
  assert.equal(sanitizeSearchTerm("a\u0000b\nc"), "a b c");
  assert.equal(sanitizeSearchTerm(undefined), "");
  assert.equal(sanitizeSearchTerm(["a", "b"]), "");
});

test("length is capped", () => {
  assert.equal(sanitizeSearchTerm("a".repeat(5000)).length, MAX_SEARCH_TERM_LENGTH);
});

test("the keyword query sanitises its input before building the filter", () => {
  const src = fs.readFileSync(path.join(ROOT, "models/project.ts"), "utf8");
  assert.match(src, /sanitizeSearchTerm\(/);
  assert.doesNotMatch(src, /ilike\.%\$\{keyword\}%/);
});
