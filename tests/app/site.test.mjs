import test from "node:test";
import assert from "node:assert/strict";

// lib/site.ts reads the environment once at import, so each case imports a fresh copy through a distinct query string.
let n = 0;
async function siteWith(env) {
  const keep = { ...process.env };
  for (const k of ["SITE_URL", "CONTACT_EMAIL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "NODE_ENV"]) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const m = await import(`../../lib/site.ts?case=${n++}`);
    return { url: m.site.url, problems: m.siteProblems() };
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
}
const ok = { SUPABASE_URL: "http://db", SUPABASE_ANON_KEY: "k", CONTACT_EMAIL: "a@b.example" };

test("a valid https SITE_URL is normalised to its origin and reports no problem", async () => {
  const r = await siteWith({ ...ok, NODE_ENV: "production", SITE_URL: "https://registry.example/some/path/" });
  assert.deepEqual(r, { url: "https://registry.example", problems: [] });
});

test("an invalid, credentialed or non-http SITE_URL falls back to a placeholder and is reported", async () => {
  for (const bad of ["not a url", "javascript:alert(1)", "https://user:pw@registry.example", "ftp://registry.example"]) {
    const r = await siteWith({ ...ok, SITE_URL: bad });
    assert.equal(r.url, "http://localhost:3000", bad);
    assert.equal(r.problems.length, 1, bad);
  }
});

test("production requires a public https SITE_URL, a contact address and database settings", async () => {
  assert.deepEqual((await siteWith({ ...ok, NODE_ENV: "production" })).problems, ["SITE_URL is not set"]);
  assert.match((await siteWith({ ...ok, NODE_ENV: "production", SITE_URL: "http://localhost:3000" })).problems[0], /public https URL/);
  assert.match((await siteWith({ NODE_ENV: "production", SITE_URL: "https://registry.example" })).problems.join("|"), /CONTACT_EMAIL.*\|SUPABASE_URL/);
  const dev = await siteWith({ ...ok });
  assert.deepEqual(dev.problems, [], "development without SITE_URL is fine");
});
