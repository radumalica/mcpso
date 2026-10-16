#!/usr/bin/env node
// Reconciliation report: proves that the counts of every pipeline stage add up, using only files the pipeline
// already wrote (no network). Every figure has a documented UNIT (records, projects, repositories, reason entries)
// and every stage transition is an explicit identity. Exits non-zero if any identity fails, so it can gate a release.
//
//   node tools/upstream-import/reconcile.mjs --out data/upstream-import
//
// Writes <out>/reconciliation.json and <out>/reconciliation.md.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

/** Counting definitions: the single place that says what each number counts. */
export const DEFINITIONS = [
  ["raw source records", "records", "issues + pull requests + ALL comments, as retrieved (stored internally with provenance)"],
  ["context-only comments", "records", "comments on issues other than the submission thread (#1); stored, never treated as submissions"],
  ["normalised records", "records", "issues + pull requests + submission-thread comments; one per source record that the normaliser processed"],
  ["submission-type records", "records", "normalised records whose intent is submission or submission_unclear (the 'relevant addition requests')"],
  ["placed records", "records", "submission-type records with a usable identity (repository, package or endpoint); each is in exactly one project"],
  ["unplaced records", "records", "submission-type records with no extractable identity; listed for manual review, not candidates"],
  ["projects / canonical candidates", "projects", "groups of placed records sharing one canonical identity; the unit that is evaluated, reviewed and may be published"],
  ["duplicate records", "records", "placed records that are not the first record of their project (= placed records - projects)"],
  ["multi-record projects", "projects", "projects with more than one record; the R1 (GitHub identity) and R4 (endpoint/package identity) merge entries are one per such project"],
  ["R2/R3/R5/R6 merge entries", "records", "one entry per record that was linked (R2 package, R3 endpoint, R5 package) or re-keyed by a rename (R6); NOT merge operations"],
  ["rename mappings", "repositories", "repositories whose GitHub-resolved owner/name differs from the submitted one (197); NOT the number of merges"],
  ["records re-keyed by rename", "records", "records whose repository key was replaced because of a rename (R6 entries)"],
  ["projects joined by rename", "projects", "multi-record projects whose records carried different original repo keys that a rename made equal (the only places a rename caused a merge)"],
  ["ambiguous projects", "projects", "distinct projects with a review-relevant ambiguity flag (monorepo_subpath_project excluded); a project can carry several flags"],
  ["N6 reason entries vs projects", "entries / projects", "N6 is recorded once per ambiguity flag, so entries (246) exceed distinct projects (196)"],
  ["eligible / needs_review / ineligible", "projects", "machine category; exactly one per project; a partition of all projects"],
  ["importable", "projects", "candidate can be stored with provenance and is not on the suppression list"],
  ["eligible_unblocked", "projects", "eligible and no security flag and no removal hold; may enter the approval queue (bulk-capable lane); NOT approved"],
  ["approved_for_publication", "projects", "human decision recorded and all publication gates passed; the pipeline never sets this (always 0 here)"],
];

/** Pure: build the reconciliation from already-loaded summaries. Exported for tests. */
export function reconcile({ collect, normalize, dedup, classification, logs = { retry_events: 0, rate_limit_events: 0 }, rawFiles = null, lanes = null }) {
  const cl = classification.project_level, rl = classification.record_level, amb = classification.ambiguity || {};
  const checks = [];
  const eq = (name, left, right) => checks.push({ name, left, right, ok: left === right });
  const le = (name, left, right) => checks.push({ name, left, right, ok: left <= right, relation: "<=" });

  const rawTotal = collect.counts.issues + collect.counts.pull_requests + collect.counts.issue_comments;
  const thread = normalize.by_source_type.submission_thread_comments;
  const context = collect.counts.issue_comments - thread;
  const submissionType = normalize.intents.submission + normalize.intents.submission_unclear;
  const nonSubmission = ["no_identity", "question_or_feedback", "code_contribution", "removal_request", "link_correction"].reduce((n, k) => n + (normalize.intents[k] || 0), 0);
  const duplicates = rl.duplicate_source_records;
  const mrc = dedup.merge_annotation_entries_by_rule || {};
  const single = cl.denominator_projects - dedup.multi_record_projects;

  // T0 independent recount of the raw files (only when the raw snapshot is present)
  if (rawFiles) {
    eq("T0a raw issues file lines = collected issues", rawFiles.issues, collect.counts.issues);
    eq("T0b raw pull-request file lines = collected pull requests", rawFiles.pull_requests, collect.counts.pull_requests);
    eq("T0c raw comment file lines = collected comments", rawFiles.comments, collect.counts.issue_comments);
    eq("T0d comments on the submission thread in the raw file = thread comments normalised", rawFiles.thread_comments, thread);
    eq("T0e importable source records (all provenance fields present) = raw records", rawFiles.records_with_complete_provenance, rawFiles.total_records);
    eq("T0f raw record keys are distinct (idempotent upsert key (type, id) has no collisions)", rawFiles.distinct_record_keys, rawFiles.total_records);
  }
  // T1-T4 records
  eq("T1 raw source records = normalised records + context-only comments", rawTotal, normalize.records + context);
  eq("T2 normalised records = issues + PRs + submission-thread comments", normalize.records, collect.counts.issues + collect.counts.pull_requests + thread);
  eq("T2b thread-comment count agrees between normalise and classify", thread, rl.submission_thread_comments);
  eq("T3 normalised records = sum of intents", normalize.records, sum(normalize.intents));
  eq("T4 normalised records = submission-type + non-submission", normalize.records, submissionType + nonSubmission);
  eq("T4b non-submission records agree between normalise and classify", nonSubmission, rl.non_submission_records);
  eq("T5 submission-type records = placed + unplaced", rl.submission_records, rl.submission_records_grouped_into_projects + rl.submission_records_without_identity);
  eq("T5b submission-type = submission + submission_unclear", rl.submission_records, submissionType);
  // T6-T8 dedup
  eq("T6 placed records = projects + duplicate records", rl.submission_records_grouped_into_projects, cl.denominator_projects + duplicates);
  eq("T6b placed records = single-record projects + records inside multi-record projects", rl.submission_records_grouped_into_projects, single + dedup.records_in_multi_record_projects);
  eq("T6c records inside multi-record projects = multi-record projects + duplicate records", dedup.records_in_multi_record_projects, dedup.multi_record_projects + duplicates);
  eq("T7 duplicate records = sum of duplicate records by basis", duplicates, sum(dedup.duplicate_records_by_basis));
  eq("T8 multi-record projects = R1 + R4 entries (project-level labels)", dedup.multi_record_projects, (mrc.R1 || 0) + (mrc.R4 || 0));
  eq("T8b multi-record projects = sum by identity type", dedup.multi_record_projects, sum(dedup.multi_record_projects_by_identity));
  eq("T8c dedup projects = classification projects", dedup.projects, cl.denominator_projects);
  le("T9 projects joined by rename <= projects containing renamed records", dedup.projects_joined_by_rename, dedup.projects_containing_renamed_records);
  le("T9b projects joined by rename <= multi-record projects", dedup.projects_joined_by_rename, dedup.multi_record_projects);
  eq("T9c R6 entries (records re-keyed) agree between summaries", dedup.records_rekeyed_by_rename, mrc.R6 || 0);
  // T10-T13 classification
  eq("T10 projects = eligible + needs_review + ineligible", cl.denominator_projects, sum(cl.category));
  eq("T10b needs_review = sum by first rule", cl.category.needs_review, sum(cl.needs_review_by_first_rule));
  eq("T10c ineligible = sum by rule", cl.category.ineligible, sum(cl.ineligible_by_rule));
  eq("T11 ambiguous projects agree between dedup and classify", dedup.ambiguous_projects, amb.ambiguous_projects);
  eq("T11b ambiguous projects = sum of ambiguous projects by category", amb.ambiguous_projects, sum(amb.ambiguous_projects_by_category));
  eq("T11c no ambiguous project is eligible", amb.ambiguous_projects_by_category?.eligible, 0);
  eq("T12 eligible = eligible_unblocked + security-only + hold-only + both", cl.category.eligible,
    cl.eligible_unblocked + cl.eligible_blocked.security_flag_only + cl.eligible_blocked.removal_hold_only + cl.eligible_blocked.both);
  le("T13 eligible_unblocked <= importable", cl.eligible_unblocked, cl.importable);
  le("T13b importable <= projects", cl.importable, cl.denominator_projects);
  eq("T13c importable + suppressed = projects", cl.importable + cl.suppressed, cl.denominator_projects);
  le("T14 approved_for_publication <= eligible_unblocked", cl.approved_for_publication, cl.eligible_unblocked);

  if (lanes) {
    const L = lanes.by_lane;
    eq("T15 approval lanes cover every project", sum(L), cl.denominator_projects);
    eq("T15b bulk + individual + family_sample = eligible_unblocked", (L.bulk || 0) + (L.individual || 0) + (L.family_sample || 0), cl.eligible_unblocked);
    eq("T15c blocked lane = eligible - eligible_unblocked", L.blocked || 0, cl.category.eligible - cl.eligible_unblocked);
    eq("T15d needs_review lane = needs_review category", L.needs_review || 0, cl.category.needs_review);
    eq("T15e not_eligible lane = ineligible category", L.not_eligible || 0, cl.category.ineligible);
    eq("T15f eligible by evidence level = eligible", sum(lanes.eligible_by_evidence_level), cl.category.eligible);
  }

  return {
    generated_at: new Date().toISOString(),
    source: { repository: "chatmcp/mcpso (renamed chatmcp/mcp-directory)", collected_at: collect.generated_at },
    definitions: DEFINITIONS.map(([name, unit, meaning]) => ({ name, unit, meaning })),
    stages: {
      "1_retrieved": { importable_source_records: rawFiles ? rawFiles.records_with_complete_provenance : null, issues: collect.counts.issues, pull_requests: collect.counts.pull_requests, comments_total: collect.counts.issue_comments, raw_source_records: rawTotal, api_errors: collect.counts.errors, retry_events_logged: logs.retry_events, rate_limit_waits_logged: logs.rate_limit_events, source_number_gaps_unretrievable: rl.issue_number_gaps },
      "2_normalised": { normalised_records: normalize.records, submission_thread_comments: thread, context_only_comments: context, by_intent: normalize.intents },
      "3_relevant_requests": { submission_type_records: rl.submission_records, placed: rl.submission_records_grouped_into_projects, unplaced: rl.submission_records_without_identity, non_submission_records: nonSubmission },
      "4_dedup": {
        canonical_candidates: cl.denominator_projects, duplicate_records: duplicates, single_record_projects: single,
        multi_record_projects: dedup.multi_record_projects, records_in_multi_record_projects: dedup.records_in_multi_record_projects,
        multi_record_projects_by_identity: dedup.multi_record_projects_by_identity, duplicate_records_by_basis: dedup.duplicate_records_by_basis,
        merge_entries_by_rule: mrc,
        renames: { repositories_mapped: dedup.rename_mappings_applied, records_rekeyed: dedup.records_rekeyed_by_rename, projects_containing_renamed_records: dedup.projects_containing_renamed_records, projects_joined_by_rename: dedup.projects_joined_by_rename },
        ambiguous_projects: dedup.ambiguous_projects, ambiguous_projects_with_multiple_flags: dedup.ambiguous_projects_with_multiple_flags, ambiguous_projects_by_flag: dedup.ambiguous_projects_by_flag,
      },
      "5_evaluation": {
        ...cl.category, needs_review_by_first_rule: cl.needs_review_by_first_rule, ineligible_by_rule: cl.ineligible_by_rule,
        N6_projects: amb.projects_with_N6_reason, N6_reason_entries: cl.reason_rule_counts?.N6 ?? null,
        ambiguous_projects_by_category: amb.ambiguous_projects_by_category,
        unavailable_or_under_documented: { repositories_not_found_or_private: classification.repository_health?.unresolved ?? null, N7_thin_metadata: cl.reason_rule_projects?.N7 ?? 0, N8_insufficient_readme: cl.reason_rule_projects?.N8 ?? 0, N5_subpath_missing: cl.reason_rule_projects?.N5 ?? 0 },
        security_flagged: cl.security_concern_projects, eligible_blocked: cl.eligible_blocked,
      },
      approval_lanes: lanes ? { by_lane: lanes.by_lane, eligible_by_evidence_level: lanes.eligible_by_evidence_level } : null,
      "6_importable_eligible_approved": { importable: cl.importable, suppressed: cl.suppressed, eligible: cl.category.eligible, eligible_unblocked: cl.eligible_unblocked, approved_for_publication: cl.approved_for_publication, published: 0 },
      content_rights: { source_records_with_unresolved_rights_status: normalize.records, note: "Rights review has not been performed for any record (policy: import-eligibility-policy.md section 6)." },
    },
    checks,
    all_checks_pass: checks.every((c) => c.ok),
  };
}

export function toMarkdown(r) {
  const s = r.stages, d = s["4_dedup"], e = s["5_evaluation"], t = s["6_importable_eligible_approved"];
  const L = [
    "# Import reconciliation", "",
    `Generated ${r.generated_at}; upstream collected ${r.source.collected_at}. All figures come from stored pipeline summaries; each has a unit (see Definitions).`, "",
    "## Stage counts", "", "| Stage | Figure (unit) | Count |", "|---|---|---|",
    `| 1 Retrieved | issues / pull requests / all comments (records) | ${s["1_retrieved"].issues} / ${s["1_retrieved"].pull_requests} / ${s["1_retrieved"].comments_total} |`,
    `| 1 Retrieved | raw source records / importable source records with complete provenance (records) | ${s["1_retrieved"].raw_source_records} / ${s["1_retrieved"].importable_source_records ?? "n/a"} |`,
    `| 1 Retrieved | API errors / retry events / rate-limit waits / unretrievable numbers | ${s["1_retrieved"].api_errors} / ${s["1_retrieved"].retry_events_logged} / ${s["1_retrieved"].rate_limit_waits_logged} / ${s["1_retrieved"].source_number_gaps_unretrievable} |`,
    `| 2 Normalised | normalised records / context-only comments (records) | ${s["2_normalised"].normalised_records} / ${s["2_normalised"].context_only_comments} |`,
    `| 3 Relevant | submission-type records = placed + unplaced (records) | ${s["3_relevant_requests"].submission_type_records} = ${s["3_relevant_requests"].placed} + ${s["3_relevant_requests"].unplaced} |`,
    `| 3 Relevant | non-submission records (records) | ${s["3_relevant_requests"].non_submission_records} |`,
    `| 4 Dedup | canonical candidates = placed - duplicates (projects) | ${d.canonical_candidates} |`,
    `| 4 Dedup | duplicate records (records) | ${d.duplicate_records} |`,
    `| 4 Dedup | single-record / multi-record projects (projects) | ${d.single_record_projects} / ${d.multi_record_projects} |`,
    `| 4 Dedup | duplicate records by basis (records) | ${JSON.stringify(d.duplicate_records_by_basis)} |`,
    `| 4 Dedup | merge entries by rule (R1/R4 per project; R2/R3/R5/R6 per record) | ${JSON.stringify(d.merge_entries_by_rule)} |`,
    `| 4 Dedup | renames: repositories mapped / records re-keyed / projects joined by rename | ${d.renames.repositories_mapped} / ${d.renames.records_rekeyed} / ${d.renames.projects_joined_by_rename} |`,
    `| 4 Dedup | ambiguous projects (projects; flags: ${JSON.stringify(d.ambiguous_projects_by_flag)}) | ${d.ambiguous_projects} |`,
    `| 5 Evaluation | eligible / needs_review / ineligible (projects) | ${e.eligible} / ${e.needs_review} / ${e.ineligible} |`,
    `| 5 Evaluation | needs_review by first rule (projects) | ${JSON.stringify(e.needs_review_by_first_rule)} |`,
    `| 5 Evaluation | ineligible by rule (projects) | ${JSON.stringify(e.ineligible_by_rule)} |`,
    `| 5 Evaluation | ambiguous projects by category / N6 projects (N6 entries) | ${JSON.stringify(e.ambiguous_projects_by_category)} / ${e.N6_projects} (${e.N6_reason_entries}) |`,
    `| 5 Evaluation | unavailable or under-documented: repos not found / N7 / N8 / N5 (projects) | ${e.unavailable_or_under_documented.repositories_not_found_or_private} / ${e.unavailable_or_under_documented.N7_thin_metadata} / ${e.unavailable_or_under_documented.N8_insufficient_readme} / ${e.unavailable_or_under_documented.N5_subpath_missing} |`,
    `| 6 Gates | importable / suppressed (projects) | ${t.importable} / ${t.suppressed} |`,
    `| 6 Gates | eligible = eligible_unblocked + blocked (security only ${e.eligible_blocked.security_flag_only}, hold only ${e.eligible_blocked.removal_hold_only}, both ${e.eligible_blocked.both}) | ${t.eligible} = ${t.eligible_unblocked} + ${t.eligible - t.eligible_unblocked} |`,
    ...(s.approval_lanes ? [`| 6 Gates | approval lanes (projects): ${JSON.stringify(s.approval_lanes.by_lane)}; eligible by evidence level ${JSON.stringify(s.approval_lanes.eligible_by_evidence_level)} | |`] : []),
    `| 6 Gates | approved_for_publication / published (projects) | ${t.approved_for_publication} / ${t.published} |`,
    "", "## Identities (every stage transition)", "", "| Check | Left | Right | OK |", "|---|---|---|---|",
    ...r.checks.map((c) => `| ${c.name} | ${c.left} | ${c.relation || "="} ${c.right} | ${c.ok ? "yes" : "**NO**"} |`), "",
    `All checks pass: **${r.all_checks_pass}**`, "",
    "## Definitions", "", "| Figure | Unit | Meaning |", "|---|---|---|",
    ...r.definitions.map((x) => `| ${x.name} | ${x.unit} | ${x.meaning} |`), "",
  ];
  return L.join("\n");
}

function countRawFiles(out) {
  const lines = (f) => (exists(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : null);
  const iss = lines(path.join(out, "raw/issues.jsonl")), prs = lines(path.join(out, "raw/pull_requests.jsonl")), com = lines(path.join(out, "raw/issue_comments.jsonl"));
  if (!iss || !prs || !com) return null;
  const REQUIRED = ["source_repo", "source_type", "source_id", "source_number", "source_url", "collected_at"];
  const all = [...iss, ...prs, ...com].map((l) => JSON.parse(l));
  const complete = all.filter((r) => REQUIRED.every((k) => r[k] !== undefined && r[k] !== null && r[k] !== "")).length;
  const distinct = new Set(all.map((r) => `${r.source_type}:${r.source_id}`)).size;
  return { issues: iss.length, pull_requests: prs.length, comments: com.length, thread_comments: com.filter((l) => JSON.parse(l).source_number === 1).length, records_with_complete_provenance: complete, distinct_record_keys: distinct, total_records: all.length };
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
  const report = reconcile({
    collect: readJson(path.join(o, "collect-manifest.json")),
    normalize: readJson(path.join(o, "normalized/normalize-summary.json")),
    dedup: readJson(path.join(o, "dedup/dedup-summary.json")),
    classification: readJson(path.join(o, "classified/classification-summary.json")),
    logs: countLogEvents(path.join(o, "logs")),
    rawFiles: countRawFiles(o),
    lanes: exists(path.join(o, "classified/approval-lanes-summary.json")) ? readJson(path.join(o, "classified/approval-lanes-summary.json")) : null,
  });
  fs.writeFileSync(path.join(o, "reconciliation.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(o, "reconciliation.md"), toMarkdown(report));
  console.log(toMarkdown(report));
  process.exit(report.all_checks_pass ? 0 : 1);
}
