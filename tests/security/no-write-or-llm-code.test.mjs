// Regression guard: the application is read-only and must not contain LLM or page-scraping code (audit F-01, F-02, F-10).
// Imported text is never fetched or summarised at request time; summaries are reviewer-approved (publication gate P6).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIRS = ["app", "components", "models", "providers", "templates", "utils", "types"];

function sources(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(tsx?|jsx?|mjs)$/.test(e.name))
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
}
const all = DIRS.flatMap(sources);
const rel = (l) => l.map((f) => path.relative(ROOT, f));

test("no services directory (LLM clients, prompts, page readers)", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "services")), false);
});

test("no LLM client or page-reader imports or endpoints in application code", () => {
  const bad = /from\s+["']openai["']|r\.jina\.ai|OPENAI_(API_KEY|MODEL|BASE_URL)/;
  assert.deepEqual(rel(all.filter((f) => bad.test(fs.readFileSync(f, "utf8")))), []);
});

test("the data models expose no insert, update or delete", () => {
  const writes = /\.(insert|update|upsert|delete)\s*\(/;
  assert.deepEqual(rel(sources("models").filter((f) => writes.test(fs.readFileSync(f, "utf8")))), []);
});
