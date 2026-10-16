import test from "node:test";
import assert from "node:assert/strict";
import { reconcile, toMarkdown } from "../reconcile.mjs";

const base = () => ({
  collect: { generated_at: "t", counts: { issues: 10, pull_requests: 1, issue_comments: 9, errors: 0 } },
  normalize: { records: 14, by_source_type: { submission_thread_comments: 3 }, intents: { submission: 9, submission_unclear: 1, code_contribution: 1, no_identity: 2, question_or_feedback: 1 } },
  dedup: { projects: 6, merge_rule_counts: { R1: 2, R4: 1, R6: 1 } },
  classification: {
    record_level: { submission_thread_comments: 3, submission_records: 10, submission_records_grouped_into_projects: 9, submission_records_without_identity: 1, non_submission_records: 4, duplicate_source_records: 3, issue_number_gaps: 2 },
    project_level: { reason_rule_counts: { I1: 1, I3: 0, N7: 2 }, denominator_projects: 6, category: { eligible: 4, needs_review: 1, ineligible: 1 }, projects_with_multiple_sources: 2, security_concern_projects: 1, eligible_but_security_flagged: 1, import_ready: 3, held_for_removal_review: 0, eligible_held_for_removal_review: 0 },
    ambiguity: { ambiguous_projects: 1 },
    repository_health: { unresolved: 1 },
  },
});

test("consistent summaries reconcile", () => {
  const r = reconcile(base());
  assert.equal(r.all_checks_pass, true);
  assert.equal(r.stages["6_review_and_publication"].published, 0);
  assert.match(toMarkdown(r), /All checks pass: \*\*true\*\*/);
});

test("a dropped record is detected", () => {
  const b = base();
  b.classification.record_level.duplicate_source_records = 2;
  const r = reconcile(b);
  assert.equal(r.all_checks_pass, false);
  assert.ok(r.checks.some((c) => !c.ok && /projects \+ duplicate/.test(c.name)));
});

test("raw source records reconcile with normalized records plus context-only comments", () => {
  const r = reconcile(base());
  assert.equal(r.stages["1_retrieved_raw"].raw_source_records, 20);
  assert.equal(r.stages["1_retrieved_raw"].context_only_comments, 6);
  const b = base();
  b.classification.record_level.submission_thread_comments = 4;
  assert.equal(reconcile(b).all_checks_pass, false);
});

test("exact vs probable duplicates, rejection reasons and unavailable counts are reported", () => {
  const r = reconcile(base());
  assert.equal(r.stages["4_dedup"].merge_decisions_exact_identifier, 3);
  assert.equal(r.stages["4_dedup"].merge_decisions_probable, 1);
  assert.equal(r.stages["5_eligibility"].ineligible_reasons.I1_registry_infrastructure, 1);
  assert.equal(r.stages["5_eligibility"].unavailable_or_under_documented.repositories_not_found_or_private, 1);
  assert.equal(r.stages["5_eligibility"].unavailable_or_under_documented.N7_thin_metadata, 2);
});

test("an unclassified merge rule is flagged", () => {
  const b = base();
  b.dedup.merge_rule_counts.R9 = 1;
  assert.equal(reconcile(b).all_checks_pass, false);
});

test("category counts that do not sum to the project total fail", () => {
  const b = base();
  b.classification.project_level.category.eligible = 5;
  assert.equal(reconcile(b).all_checks_pass, false);
});
