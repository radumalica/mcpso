// Regression guard for master plan v5 A3: no inherited analytics/advertising, no zoom lock in the viewport meta,
// no ads.txt or static sitemap naming the upstream host, no hard-coded star rating or polling of the upstream repo.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SRC_DIRS = ["app", "components", "providers", "templates", "public"];
const SKIP = /(^|\/)(node_modules|\.next|fonts)(\/|$)/;
const TEXT = /\.(tsx?|jsx?|mjs|css|html|xml|txt)$/;

function files(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && TEXT.test(e.name))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .filter((p) => !SKIP.test(path.relative(ROOT, p)));
}
const all = SRC_DIRS.flatMap(files);
const rel = (list) => list.map((f) => path.relative(ROOT, f));

test("no analytics or advertising scripts or identifiers", () => {
  const bad = /googletagmanager|googlesyndication|adsbygoogle|google-adsense-account|ca-pub-\d+|\bG-[A-Z0-9]{8,}\b/;
  assert.deepEqual(rel(all.filter((f) => bad.test(fs.readFileSync(f, "utf8")))), []);
});

test("viewport does not block zoom", () => {
  const src = fs.readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
  assert.ok(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?![.\d])/.test(src));
});

test("no ads.txt and no public file naming the upstream host", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "public/ads.txt")), false);
  assert.deepEqual(rel(files("public").filter((f) => /mcp\.so/.test(fs.readFileSync(f, "utf8")))), []);
});

test("no hard-coded star rating or polling of the upstream repository", () => {
  const bad = /api\.github\.com\/repos|alt="star"/;
  assert.deepEqual(rel(all.filter((f) => bad.test(fs.readFileSync(f, "utf8")))), []);
});
