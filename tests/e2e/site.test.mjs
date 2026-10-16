// End-to-end checks of the production build against a fake PostgREST (tests/e2e/fake-postgrest.mjs). Requires `next build` first
// (`npm run test:e2e` does both). Verifies what visitors and crawlers receive: content, wording, headers, escaping, error handling.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { startFakePostgrest } from "./fake-postgrest.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
let api, app, base, logs = "";

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = async (p, init) => {
  const r = await fetch(base + p, { redirect: "manual", ...init });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
const plain = (html) => html.replace(/<!-- -->/g, "");
const h1s = (html) => (html.match(/<h1[\s>]/g) || []).length;

before(async () => {
  assert.ok(fs.existsSync(path.join(ROOT, ".next/BUILD_ID")), "run `next build` before the e2e tests");
  api = await startFakePostgrest();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn(path.join(ROOT, "node_modules/.bin/next"), ["start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${api.port}`, SUPABASE_ANON_KEY: "test-anon-key", SITE_NAME: "Test Registry", SITE_URL: "https://registry.test", CONTACT_EMAIL: "removals@registry.test", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", (d) => (logs += d));
  app.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + "/about")).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("app did not start: " + logs.slice(-500));
});

after(async () => {
  app?.kill();
  await api?.close();
});

test("home: landmarks, language, one h1, skip link, search form, no third-party scripts, zoom allowed", async () => {
  const { status, text, headers } = await get("/");
  assert.equal(status, 200);
  assert.match(text, /<html lang="en"/);
  assert.equal(h1s(text), 1);
  assert.match(text, /href="#content"/);
  assert.match(text, /<main id="content"/);
  assert.match(text, /role="search"/);
  assert.match(text, /<label[^>]*for="q"/);
  assert.match(text, /Test Registry/);
  assert.ok(!/googletagmanager|googlesyndication|adsbygoogle|user-scalable|maximum-scale/.test(text));
  assert.ok(![...text.matchAll(/<script[^>]*\ssrc="(https?:\/\/[^"]+)"/g)].length, "no external scripts");
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.ok(!headers.get("x-powered-by"));
});

test("default catalogue hides declared-only entries; the option shows them; they are not indexed", async () => {
  const hidden = await get("/?q=declared");
  assert.match(hidden.text, /No entries match/);
  const shown = await get("/?q=declared&declared=1");
  assert.match(shown.text, /Declared Entry/);
  const page = await get("/s/declared-only");
  assert.equal(page.status, 200);
  assert.match(page.text, /<meta name="robots" content="noindex/);
  assert.match(page.text, /Declared only: this entry comes from a publisher or registry declaration dated 2026-10-01\./);
});

test("pagination: 24 per page, second page, out-of-range pages and junk page values are safe", async () => {
  const p1 = await get("/");
  assert.equal((p1.text.match(/<li class="rounded border/g) || []).length, 24);
  assert.match(plain(p1.text), /Page 1 of 2/);
  assert.match(p1.text, /rel="next"/);
  const p2 = await get("/?page=2");
  assert.match(plain(p2.text), /Page 2 of 2/);
  assert.match(p2.text, /<meta name="robots" content="noindex/);
  for (const bad of ["/?page=999", "/?page=abc", "/?page=-3", "/?page=1e9"]) assert.equal((await get(bad)).status, 200, bad);
});

test("search works, and filter-injection input never reaches the database filter as syntax", async () => {
  const hit = await get("/?q=alpha");
  assert.match(hit.text, /Alpha Tool/);
  assert.ok(!/Server 01/.test(hit.text));
  api.state.requests.length = 0;
  const evil = await get("/?q=" + encodeURIComponent("x%),status.eq.deleted,or(id.gt.0,title.ilike.%"));
  assert.equal(evil.status, 200);
  const or = api.state.requests.map((r) => r.query.or).find(Boolean) || "";
  const clauses = or.replace(/^\(|\)$/g, "").split(",");
  assert.equal(clauses.length, 2, `exactly two clauses, got: ${or}`);
  assert.match(clauses[0], /^title\.ilike\.%[^,()%"\\]*%$/, or);
  assert.match(clauses[1], /^summary\.ilike\.%[^,()%"\\]*%$/, or);
  assert.ok(!/[()]/.test(or.replace(/^\(|\)$/g, "")), `no extra parentheses: ${or}`);
});

test("listing page: required wording, as-declared labels, safe links, hostile text escaped", async () => {
  const ok = await get("/s/alpha-tool");
  assert.equal(ok.status, 200);
  assert.equal(h1s(ok.text), 1);
  assert.match(ok.text, /Static inspection on 2026-10-01: the repository depends on an MCP SDK and describes itself as a server\. The server has not been tested or security-reviewed\./);
  assert.match(ok.text, /Licence \(as declared\)/);
  assert.match(ok.text, /<link rel="canonical" href="https:\/\/registry\.test\/s\/alpha-tool"/);
  assert.match(ok.text, /rel="noopener noreferrer nofollow"/);
  assert.ok(!/\b(verified|trusted|recommended)\b/i.test(ok.text.replace(/<[^>]+>/g, " ").replace(/not been tested or security-reviewed/g, "")), "forbidden wording");

  const bad = await get("/s/hostile");
  assert.equal(bad.status, 200);
  assert.ok(!bad.text.includes("<script>alert(1)"), "title must be escaped");
  assert.ok(!bad.text.includes("<img src=x"), "summary must be escaped");
  assert.ok(!/href="javascript:/i.test(bad.text), "no javascript: links");
  assert.match(bad.text, /href="https:\/\/ok\.example\/src"/);
  assert.match(bad.text, /Shown as text only/);
});

test("unknown and malformed slugs are real 404s with the not-found page", async () => {
  for (const p of ["/s/does-not-exist", "/s/..%2Fetc", "/s/UPPER", "/s/" + "a".repeat(200)]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.match(r.text, /Page not found/);
  }
  assert.equal((await get("/server/old-style-url")).status, 404);
});

test("static pages: criteria with the exact evidence wording, non-affiliation, removal contact, privacy and terms drafts", async () => {
  const about = await get("/about");
  assert.equal(about.status, 200);
  assert.match(about.text, /not affiliated with, endorsed by or sponsored by Anthropic/);
  assert.match(about.text, /Declared only/);
  const removal = await get("/removal?entry=alpha-tool");
  assert.match(removal.text, /mailto:removals@registry\.test\?subject=Removal%20or%20correction%3A%20alpha-tool/);
  const xss = await get("/removal?entry=" + encodeURIComponent("<script>alert(1)</script>"));
  assert.ok(!xss.text.includes("<script>alert(1)"));
  for (const p of ["/privacy", "/terms"]) {
    const r = await get(p);
    assert.equal(r.status, 200);
    assert.match(r.text, /Draft for legal review/);
  }
});

test("every page has one h1, a main landmark, and no empty links or buttons", async () => {
  for (const p of ["/", "/about", "/removal", "/privacy", "/terms", "/s/alpha-tool"]) {
    const { text } = await get(p);
    assert.equal(h1s(text), 1, p);
    assert.match(text, /<main id="content"/, p);
    for (const m of text.matchAll(/<a\b[^>]*>(.*?)<\/a>/gs)) assert.ok(m[1].replace(/<[^>]+>/g, "").trim().length > 0, `empty link on ${p}`);
    for (const m of text.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)) assert.ok(m[1].replace(/<[^>]+>/g, "").trim().length > 0, `empty button on ${p}`);
  }
});

test("robots.txt and sitemap.xml: entries but not declared-only or search pages; sitemap survives a data outage", async () => {
  const robots = await get("/robots.txt");
  assert.match(robots.text, /Sitemap: https:\/\/registry\.test\/sitemap\.xml/);
  assert.match(robots.text, /Disallow: \/\*\?\*q=/);
  const sm = await get("/sitemap.xml");
  assert.equal(sm.status, 200);
  assert.match(sm.text, /https:\/\/registry\.test\/s\/alpha-tool/);
  assert.ok(!sm.text.includes("declared-only"));
  api.state.mode = "down";
  try {
    const down = await get("/sitemap.xml");
    assert.equal(down.status, 200);
    assert.match(down.text, /https:\/\/registry\.test\/about/);
  } finally { api.state.mode = "ok"; }
});

test("a data outage gives a generic error page, no internal detail, and recovers", async () => {
  api.state.mode = "down";
  try {
    const r = await get("/");
    assert.equal(r.status, 500);
    assert.ok(!/db-host-1|secret detail/.test(r.text + logs.split("\n").slice(-0).join("")), "no internal detail in the response");
    const detail = await get("/s/alpha-tool");
    assert.equal(detail.status, 500);
  } finally { api.state.mode = "ok"; }
  assert.equal((await get("/")).status, 200);
});

test("no write request ever reaches the database", async () => {
  await get("/?q=alpha"); await get("/s/alpha-tool"); await get("/sitemap.xml");
  const other = api.state.requests.filter((r) => r.path !== "/rest/v1/public_listing");
  assert.deepEqual(other, [], "only the public view is read");
  // Pages answer any method with the page itself and ignore the body; what matters is that no write ever reaches the database.
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) await get("/?q=alpha", { method: m, body: JSON.stringify({ status: "published" }), headers: { "content-type": "application/json" } });
  assert.deepEqual([...new Set(api.state.requests.map((r) => r.method))], ["GET"], "only reads reach the database");
});
