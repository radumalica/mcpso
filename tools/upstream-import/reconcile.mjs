#!/usr/bin/env node
// Reconciliation report: proves that the counts of every pipeline stage add up, using only files the
// pipeline already wrote (no network). Exits non-zero if any identity fails, so it can gate a release.
//
//   node tools/upstream-import/reconcile.mjs --out data/upstream-import
//
// Writes <out>/reconciliation.json and <out>/reconciliation.md.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);

/** Pure: build the reconciliation from already-loaded summaries. Exported for tests. */
export function reconcile({ collect, normalize, dedup, classification, logs = { retry_events: 0, rate_limit_events: 0 } }) {
  const cl = classification.project_level, rl = classification.record_level;
  const checks = [];
  const eq = (name, left, right) => checks.push({ name, left, right, ok: left === right });

  eq("normalized records = issues + PRs + submission-thread comments",
    normalize.records, collect.counts.issues + collect.counts.pull_requests + normalize.by_source_type.submission_thread_comments);
  eq("normalized records = sum of intents", normalize.records, Object.values(normalize.intents).reduce((a, b) => a + b, 0));
  const submissionType = normalize.intents.submission + normalize.intents.submission_unclear;
  eq("submission-type records = grouped + without identity", rl.submission_records, rl.submission_records_grouped_into_projects + rl.submission_records_without_identity);
  eq("submission-type records = submission + submission_unclear", rl.submission_records, submissionType);
  eq("normalized records = submission-type + non-submission", normalize.records, rl.submission_records + rl.non_submission_records);
  eq("grouped records = projects + duplicate records", rl.submission_records_grouped_into_projects, cl.denominator_projects + rl.duplicate_source_records);
  eq("projects = eligible + needs_review + ineligible", cl.denominator_projects, cl.category.eligible + cl.category.needs_review + cl.category.ineligible);
  eq("dedup projects = classification projects", dedup.projects, cl.denominator_projects);
  eq("import_ready + security-flagged eligible + removal-held eligible <= eligible",
    true, cl.import_ready + cl.eligible_but_security_flagged + (cl.eligible_held_for_removal_review ?? 0) <= cl.category.eligible);

  const report = {
    generated_at: new Date().toISOString(),
    source: { repository: "chatmcp/mcpso (renamed chatmcp/mcp-directory)", collected_at: collect.generated_at },
    stages: {
      "1_retrieved_raw": { issues: collect.counts.issues, pull_requests: collect.counts.pull_requests, comments_total: collect.counts.issue_comments, submission_thread_comments: normalize.by_source_type.submission_thread_comments, api_errors: collect.counts.errors, retry_events_logged: logs.retry_events, rate_limit_waits_logged: logs.rate_limit_events, source_number_gaps_unretrievable: rl.issue_number_gaps },
      "2_normalized_records": { total: normalize.records, by_intent: normalize.intents },
      "3_relevant_addition_requests": { submission_type_records: rl.submission_records, with_identity: rl.submission_records_grouped_into_projects, without_identity: rl.submission_records_without_identity },
      "4_dedup": { canonical_candidates: cl.denominator_projects, duplicate_source_records_merged: rl.duplicate_source_records, projects_with_multiple_sources: cl.projects_with_multiple_sources, ambiguous_for_manual_review: classification.ambiguity?.ambiguous_projects },
      "5_eligibility": { ...cl.category, security_flagged: cl.security_concern_projects, held_for_removal_review: cl.held_for_removal_review ?? 0, import_ready: cl.import_ready },
      "6_review_and_publication": { approved: 0, published: 0, note: "No reviewer decision has been recorded and nothing is published; these counts stay 0 until the review stage runs." },
      "content_rights": { source_records_with_unresolved_rights_status: normalize.records, note: "Rights review has not been performed for any record (policy: import-eligibility-policy.md section 6)." },
    },
    checks,
    all_checks_pass: checks.every((c) => c.ok),
  };
  return report;
}

export function toMarkdown(r) {
  const s = r.stages;
  const lines = [
    "# Import reconciliation", "", `Generated ${r.generated_at}; upstream collected ${r.source.collected_at}. All figures come from stored pipeline summaries.`, "",
    "| Stage | Figure | Count |", "|---|---|---|",
    `| 1 Retrieved | issues | ${s["1_retrieved_raw"].issues} |`, `| 1 Retrieved | pull requests | ${s["1_retrieved_raw"].pull_requests} |`,
    `| 1 Retrieved | comments (all) / submission-thread | ${s["1_retrieved_raw"].comments_total} / ${s["1_retrieved_raw"].submission_thread_comments} |`,
    `| 1 Retrieved | API errors / retry events / source-number gaps | ${s["1_retrieved_raw"].api_errors} / ${s["1_retrieved_raw"].retry_events_logged} / ${s["1_retrieved_raw"].source_number_gaps_unretrievable} |`,
    `| 2 Normalized | records | ${s["2_normalized_records"].total} |`,
    `| 3 Relevant | submission-type records (with / without identity) | ${s["3_relevant_addition_requests"].submission_type_records} (${s["3_relevant_addition_requests"].with_identity} / ${s["3_relevant_addition_requests"].without_identity}) |`,
    `| 4 Dedup | canonical candidates | ${s["4_dedup"].canonical_candidates} |`, `| 4 Dedup | duplicate records merged | ${s["4_dedup"].duplicate_source_records_merged} |`,
    `| 5 Eligibility | eligible / needs_review / ineligible | ${s["5_eligibility"].eligible} / ${s["5_eligibility"].needs_review} / ${s["5_eligibility"].ineligible} |`,
    `| 5 Eligibility | import-ready | ${s["5_eligibility"].import_ready} |`,
    `| 6 Review | approved / published | ${s["6_review_and_publication"].approved} / ${s["6_review_and_publication"].published} |`,
    "", "## Identities", "", "| Check | Left | Right | OK |", "|---|---|---|---|",
    ...r.checks.map((c) => `| ${c.name} | ${c.left} | ${c.right} | ${c.ok ? "yes" : "**NO**"} |`), "",
    `All checks pass: **${r.all_checks_pass}**`, "",
  ];
  return lines.join("\n");
}

function countLogEvents(dir) {
  const out = { retry_events: 0, rate_limit_events: 0 };
  if (!exists(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((n) => n.startsWith("collect"))) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (/"event":"(retry|transient_retry)"/.test(line)) out.retry_events++;
      if (/"event":"(rate_limit_wait|rate_limited)"/.test(line)) out.rate_limit_events++;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: a } = parseArgs({ options: { out: { type: "string", default: "data/upstream-import" } } });
  const o = a.out;
  const manifest = readJson(path.join(o, "collect-manifest.json"));
  const report = reconcile({
    collect: manifest,
    normalize: readJson(path.join(o, "normalized/normalize-summary.json")),
    dedup: readJson(path.join(o, "dedup/dedup-summary.json")),
    classification: readJson(path.join(o, "classified/classification-summary.json")),
    logs: countLogEvents(path.join(o, "logs")),
  });
  fs.writeFileSync(path.join(o, "reconciliation.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(o, "reconciliation.md"), toMarkdown(report));
  console.log(toMarkdown(report));
  process.exit(report.all_checks_pass ? 0 : 1);
}
