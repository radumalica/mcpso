// Deterministic stratified sampling for the hand-check (checklist B9, C4) and the hand-check result summary.
// Pure functions: the same rows and seed always give the same sample.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Secondary coverage cell: the combination a sample should spread over inside a stratum. */
export const cellOf = (r) => [r.year ?? "?", r.identity_type ?? "?", `L${r.evidence_level ?? "?"}`, r.flagged ? "flagged" : "plain"].join("|");

/**
 * Allocate `size` slots over strata: at least `minPerStratum` (or the whole stratum if smaller), the bulk lane boosted because it is
 * the one approved without individual reading, the rest proportional to stratum size.
 */
export function allocate(strataSizes, size, { minPerStratum = 10, weights = {} } = {}) {
  const names = Object.keys(strataSizes);
  const alloc = Object.fromEntries(names.map((s) => [s, Math.min(strataSizes[s], minPerStratum)]));
  let left = size - Object.values(alloc).reduce((a, b) => a + b, 0);
  const room = (s) => strataSizes[s] - alloc[s];
  while (left > 0) {
    const open = names.filter((s) => room(s) > 0);
    if (!open.length) break;
    const w = open.map((s) => (weights[s] ?? 1) * strataSizes[s]);
    const total = w.reduce((a, b) => a + b, 0);
    let given = 0;
    open.forEach((s, i) => {
      const add = Math.min(room(s), Math.floor((left * w[i]) / total));
      alloc[s] += add; given += add;
    });
    if (given === 0) { // remainders: one slot at a time to the largest remaining room
      const s = open.sort((x, y) => room(y) - room(x))[0];
      alloc[s] += 1; given = 1;
    }
    left -= given;
  }
  return alloc;
}

/**
 * @param {Array<{project_id:string, stratum:string, year?:string, identity_type?:string, evidence_level?:number, flagged?:boolean}>} rows
 * @returns {{ sample: Array, allocation: object, strata: object }} each sample row keeps its fields and gains `cell`
 */
export function stratifiedSample(rows, { size = 300, seed = 20261016, minPerStratum = 10, weights = { bulk: 2 } } = {}) {
  const byStratum = new Map();
  for (const r of rows) (byStratum.get(r.stratum) ?? byStratum.set(r.stratum, []).get(r.stratum)).push(r);
  const sizes = Object.fromEntries([...byStratum].map(([s, v]) => [s, v.length]));
  const allocation = allocate(sizes, Math.min(size, rows.length), { minPerStratum, weights });
  const rand = mulberry32(seed);
  const sample = [];
  for (const s of Object.keys(sizes).sort()) {
    // Coverage first: visit the secondary cells in random order, taking one row per cell per round until the quota is filled.
    const cells = new Map();
    for (const r of byStratum.get(s).slice().sort((a, b) => (a.project_id < b.project_id ? -1 : 1))) {
      const c = cellOf(r);
      (cells.get(c) ?? cells.set(c, []).get(c)).push(r);
    }
    const queues = shuffled([...cells.keys()].sort(), rand).map((c) => ({ c, rows: shuffled(cells.get(c), rand) }));
    let need = allocation[s];
    while (need > 0 && queues.some((q) => q.rows.length)) {
      for (const q of queues) {
        if (need === 0) break;
        const r = q.rows.shift();
        if (r) { sample.push({ ...r, cell: q.c }); need--; }
      }
    }
  }
  return { sample, allocation, strata: sizes };
}

/** Wilson score interval for k successes of n (z = 1.96 gives ≈95%). */
export function wilson(k, n, z = 1.96) {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n, z2 = z * z, d = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/**
 * Hand-check summary per stratum. `verdict` is "correct" | "incorrect" | "unclear" ("" = not yet checked).
 * A stratum FAILS only on clear evidence: the lower Wilson bound of the incorrect share exceeds `threshold`.
 * It PASSES when the upper bound is at or below the threshold; otherwise it is INCONCLUSIVE (check more rows).
 * Unclear rows count as incorrect for the bound (conservative) and are reported separately.
 */
export function summarizeHandCheck(rows, { threshold = 0.05, population = {} } = {}) {
  const out = {};
  for (const r of rows) {
    const s = (out[r.stratum] ??= { sampled: 0, checked: 0, correct: 0, incorrect: 0, unclear: 0 });
    s.sampled++;
    if (r.verdict) { s.checked++; s[r.verdict] = (s[r.verdict] ?? 0) + 1; }
  }
  for (const [name, s] of Object.entries(out)) {
    const bad = s.incorrect + s.unclear;
    const ci = wilson(bad, s.checked);
    s.population = population[name] ?? null;
    s.incorrect_share = s.checked ? bad / s.checked : null;
    s.ci95 = s.checked ? [Number(ci.low.toFixed(4)), Number(ci.high.toFixed(4))] : null;
    s.result = !s.checked ? "NOT CHECKED" : ci.low > threshold ? "FAIL" : ci.high <= threshold ? "PASS" : "INCONCLUSIVE";
  }
  return out;
}
