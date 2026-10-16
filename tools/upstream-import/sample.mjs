#!/usr/bin/env node
// Draw the stratified hand-check sample (B9/C4) from the classified candidates and write a sheet for reviewers.
//   node tools/upstream-import/sample.mjs --out data/upstream-import [--size 300] [--seed 20261016]
//   node tools/upstream-import/sample.mjs --out data/upstream-import --summarize <filled-sheet.csv>
// Strata are the approval lanes. Nothing here approves or publishes anything.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readJsonl, writeCsv, writeJsonAtomic } from "./lib/store.mjs";
import { approvalLane, evidenceLevel } from "./lib/gates.mjs";
import { stratifiedSample, summarizeHandCheck } from "./lib/sample.mjs";

export function sampleRows(classified, projects) {
  const identity = new Map(projects.map((p) => [p.project_id, p.identity_type]));
  return classified.map((r) => ({
    project_id: r.project_id,
    canonical_key: r.canonical_key,
    category: r.category,
    stratum: approvalLane(r),
    year: String(r.first_seen ?? "").slice(0, 4) || "?",
    identity_type: identity.get(r.project_id) ?? "?",
    evidence_level: evidenceLevel(r),
    flagged: (r.security_flags ?? []).length > 0 || (r.quality_indicators ?? []).includes("removal_request_pending"),
  }));
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: a } = parseArgs({ options: { out: { type: "string", default: "data/upstream-import" }, size: { type: "string", default: "300" }, seed: { type: "string", default: "20261016" }, summarize: { type: "string" } } });
  const dir = path.join(a.out, "classified");
  const rows = sampleRows(readJsonl(path.join(dir, "projects-classified.jsonl")), readJsonl(path.join(a.out, "dedup", "projects.jsonl")));
  const population = rows.reduce((m, r) => ((m[r.stratum] = (m[r.stratum] || 0) + 1), m), {});
  if (a.summarize) {
    const filled = parseCsv(fs.readFileSync(a.summarize, "utf8")).map((r) => ({ ...r, verdict: r.verdict.trim().toLowerCase() }));
    console.log(JSON.stringify(summarizeHandCheck(filled, { population }), null, 1));
  } else {
    const { sample, allocation, strata } = stratifiedSample(rows, { size: Number(a.size), seed: Number(a.seed) });
    const cols = ["project_id", "canonical_key", "stratum", "category", "year", "identity_type", "evidence_level", "flagged", "cell"];
    // Reviewer sheet: the same rows plus the questions to answer. verdict: correct | incorrect | unclear.
    writeCsv(path.join(dir, "handcheck-sheet.csv"), [...cols, "verdict", "is_mcp_server_or_client", "identity_correct", "duplicates_correct", "notes"], sample.map((r) => ({ ...r, verdict: "", is_mcp_server_or_client: "", identity_correct: "", duplicates_correct: "", notes: "" })));
    writeJsonAtomic(path.join(dir, "handcheck-sample-summary.json"), { seed: Number(a.seed), requested: Number(a.size), drawn: sample.length, population: strata, allocation, denominator_projects: rows.length });
    console.log(JSON.stringify({ drawn: sample.length, population: strata, allocation }, null, 1));
  }
}
