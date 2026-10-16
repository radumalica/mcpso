// Regression guard for audit finding F-01/F-04 (R01): no route handler may mutate state, spend money or fetch third-party
// content without an explicit authorisation check. Scans app/**/route.(ts|js) for mutating HTTP method exports.
// A mutating route must import and call `requireUser` or `requireReviewer` from "@/utils/auth" (to be implemented with
// authentication, Phase A/D); until then no mutating route may exist.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MUTATING = /export\s+(?:async\s+)?(?:function|const)\s+(POST|PUT|PATCH|DELETE)\b/;
const AUTH_CALL = /\brequire(?:User|Reviewer)\s*\(/;
const AUTH_IMPORT = /from\s+["']@\/utils\/auth["']/;

function routeFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return /^route\.(ts|tsx|js|mjs)$/.test(e.name) ? [p] : [];
  });
}

test("every mutating route handler is authorised server-side", () => {
  const offenders = [];
  for (const f of routeFiles(path.join(ROOT, "app"))) {
    const src = fs.readFileSync(f, "utf8");
    if (MUTATING.test(src) && !(AUTH_IMPORT.test(src) && AUTH_CALL.test(src))) offenders.push(path.relative(ROOT, f));
  }
  assert.deepEqual(offenders, [], `unauthenticated mutating routes: ${offenders.join(", ")}`);
});

test("the removed public write and LLM-trigger endpoints stay removed", () => {
  for (const name of ["submit-project", "submit-projects", "summarize-project", "summarize-projects"]) {
    assert.equal(fs.existsSync(path.join(ROOT, "app/api", name)), false, `app/api/${name} must not exist`);
  }
});

test("the guard itself detects an unauthenticated mutating handler", () => {
  assert.ok(MUTATING.test("export async function POST(req: Request) {}"));
  assert.ok(MUTATING.test("export const DELETE = async () => {}"));
  assert.ok(!MUTATING.test("export async function GET() {}"));
  assert.ok(AUTH_CALL.test("await requireReviewer(req)"));
  assert.ok(!AUTH_CALL.test("// requireUser is needed"));
});
