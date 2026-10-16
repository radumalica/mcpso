#!/usr/bin/env node
// Assign every classified project to an approval lane (see lib/gates.mjs) and write counts + a metadata-only CSV.
// Nothing is approved or published by this script; lanes only say HOW a human may approve each candidate.
//   node tools/upstream-import/approval_lanes.mjs --out data/upstream-import
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readJsonl, writeCsv, writeJsonAtomic } from "./lib/store.mjs";
import { approvalLane, evidenceLevel } from "./lib/gates.mjs";

export function laneReport(rows) {
  const lanes = rows.map((r) => ({ r, lane: approvalLane(r), level: evidenceLevel(r) }));
  const byLane = {};
  for (const { lane } of lanes) byLane[lane] = (byLane[lane] || 0) + 1;
  const eligibleByLevel = lanes.filter((x) => x.r.category === "eligible").reduce((m, x) => ((m[x.level] = (m[x.level] || 0) + 1), m), {});
  return { denominator_projects: rows.length, by_lane: byLane, eligible_by_evidence_level: eligibleByLevel, lanes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: a } = parseArgs({ options: { out: { type: "string", default: "data/upstream-import" } } });
  const dir = path.join(a.out, "classified");
  const rows = readJsonl(path.join(dir, "projects-classified.jsonl"));
  const rep = laneReport(rows);
  writeCsv(path.join(dir, "approval-lanes.csv"), ["project_id", "canonical_key", "category", "lane", "evidence_level"],
    rep.lanes.map(({ r, lane, level }) => ({ project_id: r.project_id, canonical_key: r.canonical_key, category: r.category, lane, evidence_level: level })));
  const { lanes, ...summary } = rep;
  writeJsonAtomic(path.join(dir, "approval-lanes-summary.json"), { generated_at: new Date().toISOString(), ...summary, approved_for_publication: 0 });
  console.log(JSON.stringify(summary, null, 1));
}
