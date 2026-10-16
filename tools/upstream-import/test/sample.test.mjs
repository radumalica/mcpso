import test from "node:test";
import assert from "node:assert/strict";
import { stratifiedSample, allocate, wilson, summarizeHandCheck, mulberry32, shuffled } from "../lib/sample.mjs";
import { sampleRows } from "../sample.mjs";

function population() {
  const lanes = { bulk: 1200, individual: 1900, needs_review: 1300, family_sample: 300, blocked: 35, not_eligible: 13 };
  const rows = [];
  let i = 0;
  for (const [stratum, n] of Object.entries(lanes)) {
    for (let k = 0; k < n; k++) rows.push({ project_id: `p${i++}`, stratum, year: String(2024 + (k % 3)), identity_type: ["github_repo", "endpoint", "package"][k % 3 === 0 ? 1 : 0], evidence_level: k % 3, flagged: k % 17 === 0 });
  }
  return rows;
}

test("the PRNG and shuffle are deterministic", () => {
  assert.deepEqual([mulberry32(1)(), mulberry32(1)()], [mulberry32(1)(), mulberry32(1)()]);
  assert.deepEqual(shuffled([1, 2, 3, 4, 5], mulberry32(9)), shuffled([1, 2, 3, 4, 5], mulberry32(9)));
});

test("same seed gives the same sample, a different seed a different one", () => {
  const rows = population();
  const a = stratifiedSample(rows, { size: 300, seed: 7 }).sample.map((r) => r.project_id);
  const b = stratifiedSample(rows, { size: 300, seed: 7 }).sample.map((r) => r.project_id);
  const c = stratifiedSample(rows, { size: 300, seed: 8 }).sample.map((r) => r.project_id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test("sample size, no duplicates, every stratum represented, small strata taken whole", () => {
  const rows = population();
  const { sample, allocation } = stratifiedSample(rows, { size: 300, seed: 1 });
  assert.equal(sample.length, 300);
  assert.equal(new Set(sample.map((r) => r.project_id)).size, 300);
  assert.equal(Object.keys(allocation).length, 6);
  for (const k of Object.keys(allocation)) assert.ok(allocation[k] >= 10, k);
  assert.equal(sample.filter((r) => r.stratum === "not_eligible").length, 10);
  assert.ok(allocation.bulk > allocation.needs_review * 0.9, "bulk lane is boosted");
});

test("coverage first: a stratum quota spreads over year, identity and evidence cells", () => {
  const rows = population();
  const { sample } = stratifiedSample(rows, { size: 300, seed: 3 });
  const bulk = sample.filter((r) => r.stratum === "bulk");
  assert.ok(new Set(bulk.map((r) => r.year)).size === 3);
  assert.ok(new Set(bulk.map((r) => r.evidence_level)).size === 3);
  assert.ok(bulk.some((r) => r.flagged) && bulk.some((r) => !r.flagged));
});

test("allocation never exceeds a stratum and never exceeds the requested size", () => {
  const a = allocate({ x: 5, y: 1000, z: 3 }, 100, { minPerStratum: 10 });
  assert.equal(a.x, 5); assert.equal(a.z, 3);
  assert.equal(Object.values(a).reduce((p, q) => p + q, 0), 100);
  assert.deepEqual(allocate({ x: 4 }, 100), { x: 4 });
});

test("wilson interval is sane", () => {
  const w = wilson(0, 60);
  assert.equal(w.low, 0);
  assert.ok(w.high > 0.04 && w.high < 0.07);
  const z = wilson(10, 20);
  assert.ok(z.low < 0.5 && z.high > 0.5);
  assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
});

test("hand-check summary: PASS only with enough clean checks, FAIL only on clear evidence, otherwise INCONCLUSIVE", () => {
  const mk = (stratum, correct, incorrect, unclear = 0, unchecked = 0) => [
    ...Array(correct).fill({ stratum, verdict: "correct" }), ...Array(incorrect).fill({ stratum, verdict: "incorrect" }),
    ...Array(unclear).fill({ stratum, verdict: "unclear" }), ...Array(unchecked).fill({ stratum, verdict: "" }),
  ];
  const s = summarizeHandCheck([...mk("clean", 100, 0), ...mk("few", 20, 0), ...mk("bad", 60, 20), ...mk("todo", 0, 0, 0, 5)], { population: { clean: 1200 } });
  assert.equal(s.clean.result, "PASS");
  assert.equal(s.clean.population, 1200);
  assert.equal(s.few.result, "INCONCLUSIVE");   // 0 of 20 cannot show the rate is under 5%
  assert.equal(s.bad.result, "FAIL");
  assert.equal(s.todo.result, "NOT CHECKED");
  assert.equal(s.todo.sampled, 5);
});

test("unclear verdicts count against a stratum", () => {
  const rows = [...Array(70).fill({ stratum: "u", verdict: "correct" }), ...Array(30).fill({ stratum: "u", verdict: "unclear" })];
  const s = summarizeHandCheck(rows);
  assert.equal(s.u.unclear, 30);
  assert.equal(s.u.result, "FAIL");
});

test("sampleRows derives lane, year, identity type and evidence level from the pipeline rows", () => {
  const classified = [{ project_id: "p1", canonical_key: "github.com/a/b", category: "eligible", first_seen: "2025-03-01T00:00:00Z", security_flags: [], quality_indicators: ["removal_request_pending"], evidence_strong: ["root:py-dep:pyproject.toml"], evidence_kinds: ["sdk-dependency"], evidence_weak: [] }];
  const [r] = sampleRows(classified, [{ project_id: "p1", identity_type: "github_repo" }]);
  assert.equal(r.year, "2025");
  assert.equal(r.identity_type, "github_repo");
  assert.equal(r.flagged, true);
  assert.ok(r.stratum && Number.isInteger(r.evidence_level));
});
