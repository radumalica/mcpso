import test from "node:test";
import assert from "node:assert/strict";
import { evidenceLevel, publicFields, publicationGateFailures, approvalLane, planBulkAction, confirmBulk, bulkUndoRecord, BULK_LIMIT, EVIDENCE_WORDING } from "../lib/gates.mjs";

const row = (id, over = {}) => ({
  project_id: id, category: "eligible", security_concern: false, importable: true, quality_indicators: [], ambiguity_flags: [],
  evidence_kinds: ["manifest-file", "sdk-dependency", "wording"], repo: { name_with_owner: `o/${id}` }, authors: [`a-${id}`], reasons: [{ rule: "E1" }], ...over,
});
const okCandidate = () => ({
  category: "eligible", evidence_level: 2, min_fields: { name: 1, source_link: 1, install_or_endpoint_or_not_documented: 1, licence_or_unknown: 1, content_type: 1, last_checked_at: 1 },
  summary: { approved: true, kind: "template" }, rights: {},
});

test("evidence levels and wording: declaration-only never claims more than it knows", () => {
  assert.equal(evidenceLevel(row("a")), 2);
  assert.equal(evidenceLevel(row("b", { evidence_kinds: ["registry"] })), 1);
  // a manifest file is a self-published declaration like a registry entry: level 1, never bulk
  assert.equal(evidenceLevel(row("m", { evidence_kinds: ["manifest-file", "registry"] })), 1);
  assert.equal(approvalLane(row("m", { evidence_kinds: ["manifest-file"] })), "individual");
  assert.equal(evidenceLevel(row("c", { evidence_kinds: ["registry"], repo: null })), 0);
  assert.match(EVIDENCE_WORDING[0], /has not checked/);
  assert.ok(!Object.values(EVIDENCE_WORDING).some((w) => /verified|safe|secure/i.test(w.replace(/security-reviewed/g, ""))));
  assert.ok(!publicFields(0).includes("licence_spdx"));
  for (const lvl of [0, 1, 2]) for (const banned of ["description", "readme", "comments", "logo", "screenshot", "author_login", "contact"]) {
    assert.ok(!publicFields(lvl).some((f) => f.includes(banned)), `${banned} must never be public by default`);
  }
});

test("all gates pass for a clean, approved, template-summarised candidate", () => {
  assert.deepEqual(publicationGateFailures(okCandidate()), []);
});

test("each mandatory gate blocks publication", () => {
  const g = (over) => publicationGateFailures({ ...okCandidate(), ...over }).map((x) => x.gate);
  assert.ok(g({ category: "needs_review" }).includes("P1"));
  assert.deepEqual(g({ category: "needs_review", override_reason: "reviewed by hand, repo confirmed" }), []);
  assert.ok(g({ security_flags_unresolved: true }).includes("P2"));
  assert.ok(g({ removal_hold: true }).includes("P3"));
  assert.ok(g({ suppressed: true }).includes("P3"));
  assert.ok(g({ open_takedown: true }).includes("P3"));
  assert.ok(g({ ambiguity_open: true }).includes("P4"));
  assert.ok(g({ min_fields: { ...okCandidate().min_fields, last_checked_at: null } }).includes("P5"));
  assert.ok(g({ summary: { approved: false, kind: "template" } }).includes("P6"));
  assert.ok(g({ summary: { approved: true, kind: "third_party_text" } }).includes("P6"));
  assert.ok(g({ rights: { restricted: true } }).includes("P7"));
  assert.ok(g({ rights: { includes_third_party_media: true } }).includes("P7"));
  assert.ok(g({ rights: { includes_personal_data: true } }).includes("P7"));
  assert.ok(g({ evidence_level: 0 }).includes("P8"));
  assert.deepEqual(g({ evidence_level: 0, individually_reviewed: true }), []);
});

test("an override reason never clears security, removal, suppression or rights gates", () => {
  const c = { ...okCandidate(), category: "needs_review", override_reason: "trust me", security_flags_unresolved: true, removal_hold: true, suppressed: true, rights: { restricted: true } };
  const gates = publicationGateFailures(c).map((x) => x.gate);
  for (const g of ["P2", "P3", "P7"]) assert.ok(gates.includes(g), g);
});

test("approval lanes", () => {
  assert.equal(approvalLane(row("a")), "bulk");
  assert.equal(approvalLane(row("b", { category: "needs_review" })), "needs_review");
  assert.equal(approvalLane(row("c", { category: "ineligible" })), "not_eligible");
  assert.equal(approvalLane(row("d", { security_concern: true })), "blocked");
  assert.equal(approvalLane(row("e", { quality_indicators: ["removal_request_pending"] })), "blocked");
  assert.equal(approvalLane(row("f", { quality_indicators: ["suppressed"], importable: false })), "blocked");
  assert.equal(approvalLane(row("g", { ambiguity_flags: ["shared_package_across_repos"] })), "blocked");
  assert.equal(approvalLane(row("h", { ambiguity_flags: ["monorepo_subpath_project"] })), "bulk");
  assert.equal(approvalLane(row("i", { evidence_kinds: ["registry"] })), "individual");
  assert.equal(approvalLane(row("j", { quality_indicators: ["archived"] })), "individual");
  assert.equal(approvalLane(row("k", { quality_indicators: ["bulk_submitter"] })), "family_sample");
});

test("bulk approve never includes blocked, declared-only, needs-review or unsampled-family candidates", () => {
  const rows = [row("ok"), row("sec", { security_concern: true }), row("hold", { quality_indicators: ["removal_request_pending"] }), row("decl", { evidence_kinds: ["registry"] }),
    row("nr", { category: "needs_review" }), row("fam", { quality_indicators: ["bulk_submitter"] }), row("sup", { importable: false, quality_indicators: ["suppressed"] })];
  const plan = planBulkAction(rows, { action: "approve" });
  assert.deepEqual(plan.ids, ["ok"]);
  assert.equal(plan.excluded_count, 6);
  const withSample = planBulkAction(rows, { action: "approve", sampleAudited: new Set(["a-fam"]) });
  assert.deepEqual(withSample.ids.sort(), ["fam", "ok"]);
});

test("bulk scope is bounded, previewed, confirmed and recoverable", () => {
  const many = Array.from({ length: BULK_LIMIT + 50 }, (_, i) => row(`p${i}`));
  const plan = planBulkAction(many, { action: "approve" });
  assert.equal(plan.preview_count, BULK_LIMIT);
  assert.equal(plan.truncated_by_limit, true);
  assert.throws(() => planBulkAction(many, { action: "approve", limit: BULK_LIMIT + 1 }), /bulk limit/);
  assert.throws(() => confirmBulk(plan, BULK_LIMIT - 1), /differs from previewed/);
  assert.equal(confirmBulk(plan, BULK_LIMIT).confirmed, true);
  const prev = new Map(plan.ids.map((id) => [id, "eligible"]));
  const undo = bulkUndoRecord(plan, prev);
  assert.equal(undo.items.length, BULK_LIMIT);
  assert.ok(undo.items.every((i) => i.previous_status === "eligible"));
  assert.throws(() => planBulkAction(many, { action: "delete" }), /unsupported/);
});

test("bulk reject only for infrastructure/empty-template ineligible candidates", () => {
  const rows = [row("i1", { category: "ineligible", reasons: [{ rule: "I1" }] }), row("i3", { category: "ineligible", reasons: [{ rule: "I3" }] }), row("n1", { category: "needs_review", reasons: [{ rule: "N1" }] })];
  assert.deepEqual(planBulkAction(rows, { action: "reject" }).ids, ["i1"]);
});

test("inputs are not mutated", () => {
  const rows = [row("ok")];
  const snapshot = JSON.stringify(rows);
  planBulkAction(rows, { action: "approve" });
  approvalLane(rows[0]);
  assert.equal(JSON.stringify(rows), snapshot);
});
