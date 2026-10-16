// Baseline security headers are configured for every path and the framework banner is off.
import test from "node:test";
import assert from "node:assert/strict";
import config, { securityHeaders } from "../../next.config.mjs";

test("baseline security headers apply to all paths", async () => {
  const rules = await config.headers();
  const all = rules.find((r) => r.source === "/:path*");
  assert.ok(all);
  const keys = all.headers.map((h) => h.key);
  for (const k of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security"]) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
  assert.equal(securityHeaders.find((h) => h.key === "X-Content-Type-Options").value, "nosniff");
});

test("X-Powered-By is disabled", () => {
  assert.equal(config.poweredByHeader, false);
});
