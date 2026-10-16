// Independence and licence compliance (publication gate LG9): no upstream names, hosts, tracking IDs or inherited assets in the
// application; LICENSE kept; NOTICE present with a statement of modifications; no bundled third-party fonts, images or templates.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const APP_DIRS = ["app", "components", "lib", "models", "utils", "public"];
const APP_FILES = ["package.json", "next.config.mjs", "tailwind.config.ts", ".env.example", "README.md"];
const TEXT = /\.(tsx?|jsx?|mjs|css|html|xml|txt|json|svg|md|example)$/;

function files(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile()).map((e) => path.join(e.parentPath ?? e.path, e.name));
}
const all = [...APP_DIRS.flatMap(files), ...APP_FILES.map((f) => path.join(ROOT, f)).filter(fs.existsSync)];
const rel = (l) => l.map((f) => path.relative(ROOT, f));

test("no upstream names, hosts or contact addresses in the application", () => {
  const bad = /\bmcp\.so\b|chatmcp|mcp-directory|mcpso|support@mcp|t\.me\/\+|discord\.gg\//i;
  const hits = all.filter((f) => TEXT.test(f) && bad.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(rel(hits), []);
});

test("no bundled fonts, raster images or inherited template directories", () => {
  const assets = all.filter((f) => /\.(woff2?|ttf|otf|png|jpe?g|gif|webp|ico)$/i.test(f));
  assert.deepEqual(rel(assets), []);
  for (const d of ["templates", "pagejson", "providers", "services"]) assert.equal(fs.existsSync(path.join(ROOT, d)), false, d);
});

test("LICENSE is kept and NOTICE credits the original work and states the modifications", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8"), /Apache License\s+Version 2\.0/);
  const notice = fs.readFileSync(path.join(ROOT, "NOTICE"), "utf8");
  assert.match(notice, /Apache License, Version 2\.0/);
  assert.match(notice, /modified derivative work/);
  assert.match(notice, /Statement of modifications/);
  assert.match(notice, /not affiliated with, endorsed\s+by or operated by the original project/);
});

test("package metadata does not carry the inherited name", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.notEqual(pkg.name, "navfast");
  for (const dep of ["openai", "vercel", "@cloudflare/next-on-pages", "xmlbuilder", "next-themes"]) {
    assert.ok(!(dep in { ...pkg.dependencies, ...pkg.devDependencies }), dep);
  }
});
