import test from "node:test";
import assert from "node:assert/strict";
import { reconcile, toMarkdown, DEFINITIONS } from "../reconcile.mjs";

// Consistent synthetic fixture. Units: 10 issues + 1 PR + 9 comments (3 on the submission thread, 6 context-only) = 20 raw records;
// 14 normalised records = 10 + 1 + 3; 10 submission-type = 9 placed + 1 unplaced; 9 placed = 6 projects + 3 duplicate records;
// 2 multi-record projects hold 5 records (= 2 + 3 duplicates); 4 single-record projects.
const base = () => ({
  collect: { generated_at: "t", counts: { issues: 10, pull_requests: 1, issue_comments: 9, errors: 0 } },
  normalize: { records: 14, by_source_type: { submission_thread_comments: 3 }, intents: { submission: 9, submission_unclear: 1, code_contribution: 1, no_identity: 2, question_or_feedback: 1 } },
  dedup: {
    projects: 6, multi_record_projects: 2, records_in_multi_record_projects: 5, multi_record_projects_by_identity: { github_repo: 1, endpoint: 1 },
    duplicate_records_by_basis: { same_key_as_group: 2, linked_by_R6: 1 },
    merge_annotation_entries_by_rule: { R1: 1, R4: 1, R6: 1 },
    rename_mappings_applied: 2, records_rekeyed_by_rename: 1, projects_containing_renamed_records: 1, projects_joined_by_rename: 1,
    ambiguous_projects: 1, ambiguous_projects_with_multiple_flags: 0, ambiguous_projects_by_flag: { shared_package_across_repos: 1 },
  },
  classification: {
    record_level: { submission_thread_comments: 3, submission_records: 10, submission_records_grouped_into_projects: 9, submission_records_without_identity: 1, non_submission_records: 4, duplicate_source_records: 3, issue_number_gaps: 2 },
    project_level: {
      denominator_projects: 6, category: { eligible: 4, needs_review: 1, ineligible: 1 },
      needs_review_by_first_rule: { N6: 1 }, ineligible_by_rule: { I1: 1 },
      eligible_blocked: { security_flag_only: 1, removal_hold_only: 0, both: 0 },
      eligible_unblocked: 3, importable: 6, suppressed: 0, approved_for_publication: 0, security_concern_projects: 1,
      reason_rule_counts: { N6: 2, N7: 2 }, reason_rule_projects: { N6: 1, N7: 2 },
    },
    ambiguity: { ambiguous_projects: 1, ambiguous_projects_by_category: { eligible: 0, needs_review: 1, ineligible: 0 }, projects_with_N6_reason: 1 },
    repository_health: { unresolved: 1 },
  },
});
const rawFiles = () => ({ issues: 10, pull_requests: 1, comments: 9, thread_comments: 3 });
const mutate = (fn, withRaw = false) => { const b = base(); if (withRaw) b.rawFiles = rawFiles(); fn(b); return reconcile(b); };
const failing = (r) => r.checks.filter((c) => !c.ok).map((c) => c.name.split(" ")[0]);

test("consistent summaries reconcile and approval/publication stay zero", () => {
  const r = reconcile(base());
  assert.equal(r.all_checks_pass, true);
  assert.equal(r.stages["6_importable_eligible_approved"].approved_for_publication, 0);
  assert.equal(r.stages["6_importable_eligible_approved"].published, 0);
  assert.match(toMarkdown(r), /All checks pass: \*\*true\*\*/);
});

test("every figure family has a documented unit", () => {
  assert.ok(DEFINITIONS.length >= 15);
  for (const [name, unit, meaning] of DEFINITIONS) { assert.ok(name && unit && meaning.length > 10); }
  assert.ok(DEFINITIONS.some(([n, u]) => /rename mappings/.test(n) && u === "repositories"));
  assert.ok(DEFINITIONS.some(([n, u]) => /R2\/R3\/R5\/R6/.test(n) && u === "records"));
});

test("independent recount of the raw files (T0)", () => {
  assert.equal(mutate(() => {}, true).all_checks_pass, true);
  assert.ok(failing(mutate((b) => { b.rawFiles.comments = 8; }, true)).includes("T0c"));
  assert.ok(failing(mutate((b) => { b.rawFiles.thread_comments = 2; }, true)).includes("T0d"));
  assert.ok(failing(mutate((b) => { b.rawFiles.issues = 11; }, true)).includes("T0a"));
});

test("raw / normalised record transitions (T1, T2, T2b)", () => {
  assert.ok(failing(mutate((b) => { b.normalize.records = 15; })).includes("T2"));
  assert.deepEqual(failing(mutate((b) => { b.classification.record_level.submission_thread_comments = 4; })), ["T2b"]);
});

test("placed + unplaced and duplicate-record transitions (T5, T6, T7)", () => {
  assert.ok(failing(mutate((b) => { b.classification.record_level.submission_records_without_identity = 2; })).includes("T5"));
  assert.ok(failing(mutate((b) => { b.classification.record_level.duplicate_source_records = 2; })).includes("T6"));
  assert.ok(failing(mutate((b) => { b.dedup.duplicate_records_by_basis = { same_key_as_group: 2 }; })).includes("T7"));
});

test("merge entries are project-level labels, not merge operations (T8)", () => {
  assert.ok(failing(mutate((b) => { b.dedup.merge_annotation_entries_by_rule.R1 = 5; })).includes("T8"));
  assert.ok(failing(mutate((b) => { b.dedup.multi_record_projects_by_identity = { github_repo: 1 }; })).includes("T8b"));
});

test("renames: joined projects cannot exceed projects with renamed records (T9)", () => {
  assert.ok(failing(mutate((b) => { b.dedup.projects_joined_by_rename = 2; })).includes("T9"));
  const ok = reconcile(base()).stages["4_dedup"].renames;
  assert.deepEqual(ok, { repositories_mapped: 2, records_rekeyed: 1, projects_containing_renamed_records: 1, projects_joined_by_rename: 1 });
});

test("category partition and first-rule breakdowns (T10)", () => {
  assert.ok(failing(mutate((b) => { b.classification.project_level.category.eligible = 5; })).includes("T10"));
  assert.ok(failing(mutate((b) => { b.classification.project_level.needs_review_by_first_rule = { N6: 2 }; })).includes("T10b"));
  assert.ok(failing(mutate((b) => { b.classification.project_level.ineligible_by_rule = {}; })).includes("T10c"));
});

test("ambiguity: counts agree and no ambiguous project is eligible (T11)", () => {
  assert.ok(failing(mutate((b) => { b.dedup.ambiguous_projects = 2; })).includes("T11"));
  assert.ok(failing(mutate((b) => { b.classification.ambiguity.ambiguous_projects_by_category = { eligible: 1, needs_review: 0, ineligible: 0 }; })).includes("T11c"));
});

test("eligible splits into unblocked and blocked, nothing else (T12)", () => {
  assert.ok(failing(mutate((b) => { b.classification.project_level.eligible_unblocked = 4; })).includes("T12"));
});

test("importable, eligible_unblocked and approved are separate and ordered (T13, T14)", () => {
  assert.ok(failing(mutate((b) => { b.classification.project_level.suppressed = 1; })).includes("T13c"));
  assert.ok(failing(mutate((b) => { b.classification.project_level.importable = 2; b.classification.project_level.suppressed = 4; })).includes("T13"));
  assert.ok(failing(mutate((b) => { b.classification.project_level.approved_for_publication = 4; })).includes("T14"));
});

test("rejection reasons and unavailable counts are reported with units", () => {
  const e = reconcile(base()).stages["5_evaluation"];
  assert.deepEqual(e.ineligible_by_rule, { I1: 1 });
  assert.equal(e.unavailable_or_under_documented.repositories_not_found_or_private, 1);
  assert.equal(e.unavailable_or_under_documented.N7_thin_metadata, 2);
  assert.equal(e.N6_projects, 1);
  assert.equal(e.N6_reason_entries, 2);
});

test("approval lanes reconcile with categories and never include approved candidates", () => {
  const lanes = { by_lane: { bulk: 2, individual: 1, family_sample: 0, blocked: 1, needs_review: 1, not_eligible: 1 }, eligible_by_evidence_level: { 0: 1, 1: 0, 2: 3 } };
  const ok = mutate(() => {});
  assert.equal(ok.all_checks_pass, true);
  const b = base(); b.lanes = lanes;
  assert.equal(reconcile(b).all_checks_pass, true);
  b.lanes = { ...lanes, by_lane: { ...lanes.by_lane, bulk: 3 } };
  const bad = reconcile(b);
  assert.ok(failing(bad).includes("T15b"));
});
