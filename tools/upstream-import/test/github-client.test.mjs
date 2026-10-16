// GitHubClient behaviour against a scripted fake fetch: pagination, rate limiting, retries, error handling, token hygiene.
import test from "node:test";
import assert from "node:assert/strict";
import { GitHubClient, GitHubError, redact } from "../lib/github.mjs";

const FAKE_TOKEN = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

/** Builds a client whose fetch replays `script` (array of Response or Error), recording calls and sleeps. */
function harness(script, opts = {}) {
  const calls = [];
  const sleeps = [];
  const logs = [];
  const queue = [...script];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return next;
  };
  const client = new GitHubClient({
    fetchImpl,
    sleep: async (ms) => void sleeps.push(ms),
    log: (e) => logs.push(e),
    maxRetries: 3,
    baseDelayMs: 10,
    maxDelayMs: 100,
    now: () => 1_000_000_000_000,
    ...opts,
  });
  return { client, calls, sleeps, logs };
}
const json = (body, headers = {}, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("follows rel=next across pages and stops when there is none", async () => {
  const p2 = "https://api.github.com/repos/o/r/issues?page=2";
  const { client, calls } = harness([
    json([{ id: 1 }], { link: `<${p2}>; rel="next", <https://api.github.com/x?page=9>; rel="last"` }),
    json([{ id: 2 }]),
  ]);
  const seen = [];
  for await (const page of client.pages("repos/o/r/issues")) seen.push(...page.items.map((i) => i.id));
  assert.deepEqual(seen, [1, 2]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, p2);
});

test("404, 410 and 451 are returned, not thrown", async () => {
  for (const status of [404, 410, 451]) {
    const { client } = harness([new Response("{}", { status })]);
    const r = await client.get("repos/o/gone");
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
  }
});

test("a list endpoint that returns 404 is an error", async () => {
  const { client } = harness([new Response("{}", { status: 404 })]);
  await assert.rejects(async () => {
    for await (const _ of client.pages("repos/o/gone/issues")) void _;
  }, GitHubError);
});

test("Retry-After on 429 is honoured before the retry", async () => {
  const { client, sleeps, calls } = harness([new Response("slow down", { status: 429, headers: { "retry-after": "7" } }), json({ ok: 1 })]);
  const r = await client.get("rate_limit");
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [8000]);
});

test("403 with an exhausted quota waits until the reset time", async () => {
  const resetEpoch = 1_000_000_000 + 120; // now() is 1_000_000_000 s; reset in 120 s
  const { client, sleeps } = harness([
    new Response("forbidden", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetEpoch) } }),
    json({ ok: 1 }),
  ]);
  await client.get("rate_limit");
  assert.equal(sleeps[0], 120_000 + 1500);
});

test("a low remaining quota pauses before the next request", async () => {
  const resetEpoch = 1_000_000_000 + 30;
  const { client, sleeps } = harness([
    json({ a: 1 }, { "x-ratelimit-remaining": "3", "x-ratelimit-reset": String(resetEpoch) }),
    json({ b: 2 }),
  ]);
  await client.get("a");
  await client.get("b");
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 30_000 + 1500);
});

test("a reset too far away aborts instead of sleeping for hours", async () => {
  const { client } = harness(
    [new Response("x", { status: 429, headers: { "retry-after": "999999" } })],
    { maxRateLimitWaitMs: 60_000 },
  );
  await assert.rejects(client.get("a"), /too long/);
});

test("5xx is retried with backoff and then succeeds", async () => {
  const { client, sleeps, calls } = harness([new Response("", { status: 502 }), new Response("", { status: 503 }), json({ ok: 1 })]);
  const r = await client.get("a");
  assert.equal(r.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(sleeps.length, 2);
});

test("persistent 5xx gives up after maxRetries + 1 attempts", async () => {
  const { client, calls } = harness([500, 500, 500, 500].map((s) => new Response("", { status: s })));
  await assert.rejects(client.get("a"), /gave up after 4 attempts/);
  assert.equal(calls.length, 4);
});

test("network errors are retried", async () => {
  const { client, calls } = harness([new Error("ECONNRESET"), json({ ok: 1 })]);
  const r = await client.get("a");
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
});

test("other 4xx fails immediately without retry", async () => {
  const { client, calls } = harness([new Response("bad", { status: 422 })]);
  await assert.rejects(client.get("a"), (e) => e instanceof GitHubError && e.status === 422);
  assert.equal(calls.length, 1);
});

test("malformed JSON in a 200 response is a GitHubError, not a raw SyntaxError", async () => {
  const { client } = harness([new Response("{not json", { status: 200 })]);
  await assert.rejects(client.get("a"), (e) => e instanceof GitHubError && /malformed JSON/.test(e.message));
});

test("only api.github.com over https is requested", async () => {
  const { client, calls } = harness([]);
  for (const bad of ["http://api.github.com/x", "https://evil.example/x", "https://api.github.com.evil.example/x"]) {
    await assert.rejects(client.get(bad), GitHubError);
  }
  assert.equal(calls.length, 0);
});

test("the token goes only in the Authorization header and never into logs or errors", async () => {
  const { client, calls, logs } = harness(
    [new Response(`echo ${FAKE_TOKEN}`, { status: 500 }), new Response(`leak ${FAKE_TOKEN}`, { status: 422 })],
    { token: FAKE_TOKEN },
  );
  await assert.rejects(client.get("a"), (e) => {
    assert.ok(!e.message.includes(FAKE_TOKEN));
    return true;
  });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
  assert.ok(!JSON.stringify(logs).includes(FAKE_TOKEN));
  assert.ok(!calls[0].url.includes(FAKE_TOKEN));
});

test("no Authorization header without a token", async () => {
  const { client, calls } = harness([json({})]);
  await client.get("a");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("redact scrubs classic and fine-grained token shapes", () => {
  assert.equal(redact(`x ${FAKE_TOKEN} y`), "x [REDACTED] y");
  assert.equal(redact("github_pat_" + "A".repeat(30)), "[REDACTED]");
});
