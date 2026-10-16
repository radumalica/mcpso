// Publication gates, evidence levels, approval lanes and bounded bulk actions as PURE functions.
// This is the executable specification that the database transition functions (db/migrations/0002_*.sql) must mirror;
// it is tested here without a database. Nothing in this module publishes anything: it only decides what MAY be
// proposed, and which gates are still failing. Policy: reports/import-eligibility-policy.md, reports/publication-gate-checklist.md.

export const BULK_LIMIT = 500;
export const SAMPLE_FRACTION = 0.05;

/** Evidence levels (D7 resolution). Level 3 (tested) is reserved and never produced here. */
export const EVIDENCE_WORDING = {
  0: "Declared only: this entry comes from a publisher or registry declaration dated {date}. The registry has not checked the server or its repository.",
  1: "Repository facts checked on {date} (exists, public, licence, last activity). The server has not been tested or security-reviewed.",
  2: "Static inspection on {date}: a manifest or SDK dependency indicates an MCP server. The server has not been tested or security-reviewed.",
};

/**
 * Evidence level from stored classification facts (no network, no execution).
 *  2: repository resolved AND a manifest file or SDK dependency evidence (code-level signal)
 *  1: repository resolved but only registry/weak evidence
 *  0: no resolved repository (endpoint/package identity, or unresolved repo), declaration only
 */
export function evidenceLevel(row) {
  const kinds = new Set(row.evidence_kinds || []);
  const resolved = !!(row.repo && row.repo.name_with_owner);
  if (resolved && (kinds.has("manifest-file") || kinds.has("sdk-dependency"))) return 2;
  if (resolved) return 1;
  return 0;
}

/**
 * What may be shown publicly for a candidate that is approved. Third-party prose, comments, logos, screenshots and
 * personal data are NEVER in this list (they need a rights/privacy decision; see the policy, section 6).
 */
export function publicFields(level) {
  const base = ["display_name_from_repo_or_identifier", "canonical_source_link", "source_issue_link", "retrieved_at", "evidence_level", "evidence_wording", "content_type"];
  if (level >= 1) base.push("licence_spdx", "language", "archived", "last_pushed_at", "hosting_and_transports_declared");
  if (level >= 2) base.push("manifest_declared_package_ids", "manifest_declared_endpoint");
  return base;
}

/** The publication gates P1-P7. Returns the list of FAILING gates (empty = all passed). */
export function publicationGateFailures(c) {
  const f = [];
  const fail = (gate, reason) => f.push({ gate, reason });
  if (!(c.category === "eligible" || (c.override_reason && c.override_reason.trim()))) fail("P1", "not eligible and no written reviewer override");
  if (c.security_flags_unresolved) fail("P2", "unresolved security flag");
  if (c.removal_hold) fail("P3", "removal hold");
  if (c.suppressed) fail("P3", "canonical key on the suppression list");
  if (c.open_takedown) fail("P3", "open takedown or rights complaint");
  if (c.ambiguity_open) fail("P4", "unresolved duplicate/ambiguity group");
  const m = c.min_fields || {};
  for (const k of ["name", "source_link", "install_or_endpoint_or_not_documented", "licence_or_unknown", "content_type", "last_checked_at"]) {
    if (!m[k]) fail("P5", `missing minimum field: ${k}`);
  }
  const s = c.summary || {};
  if (!s.approved) fail("P6", "summary not approved");
  if (s.kind === "third_party_text") fail("P6", "summary reproduces third-party prose");
  const r = c.rights || {};
  if (r.restricted) fail("P7", "rights restriction on this record");
  if (r.includes_third_party_media) fail("P7", "third-party logo/screenshot without permission");
  if (r.includes_personal_data) fail("P7", "personal data in public fields without a privacy decision");
  if (c.evidence_level === 0 && !c.individually_reviewed) fail("P8", "declared-only evidence requires individual review (never bulk)");
  return f;
}

/**
 * Approval lanes (who may be approved how). Counts for the audit dataset are produced by tools/upstream-import/approval_lanes.mjs.
 *  not_eligible / needs_review : never approvable by bulk
 *  blocked                     : eligible but security flag or removal hold or suppressed (never approvable until cleared)
 *  individual                  : eligible_unblocked but evidence level 0, or archived/stale, or no resolved repo
 *  family_sample               : eligible_unblocked with level-2 evidence from a bulk-submitter/template family: bulk only after a 5% sample audit passes
 *  bulk                        : eligible_unblocked with level-2 evidence, not archived, not from a template family
 */
export function approvalLane(row) {
  if (row.category === "ineligible") return "not_eligible";
  if (row.category !== "eligible") return "needs_review";
  const qi = new Set(row.quality_indicators || []);
  if (row.security_concern || qi.has("removal_request_pending") || qi.has("suppressed") || row.importable === false || (row.ambiguity_flags || []).some((x) => x !== "monorepo_subpath_project")) return "blocked";
  if (evidenceLevel(row) < 2 || qi.has("archived") || qi.has("stale")) return "individual";
  if (qi.has("bulk_submitter") || qi.has("tools_not_listed")) return "family_sample";
  return "bulk";
}

/** Plan a bulk action: returns the exact scope and everything that was excluded, with reasons. Never mutates input. */
export function planBulkAction(rows, { action, limit = BULK_LIMIT, sampleAudited = new Set() } = {}) {
  if (!["approve", "reject"].includes(action)) throw new Error(`unsupported bulk action: ${action}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > BULK_LIMIT) throw new Error(`bulk limit must be 1..${BULK_LIMIT}`);
  const included = [], excluded = [];
  for (const r of rows) {
    const lane = approvalLane(r);
    const familyOk = lane === "family_sample" && sampleAudited.has(r.family || r.authors?.[0]);
    const okApprove = action === "approve" && (lane === "bulk" || familyOk);
    const okReject = action === "reject" && r.category === "ineligible" && ["I1", "I2"].includes(r.reasons?.[0]?.rule);
    if (okApprove || okReject) included.push(r.project_id);
    else excluded.push({ project_id: r.project_id, reason: `lane:${lane}` });
  }
  const capped = included.slice(0, limit);
  return { action, ids: capped, preview_count: capped.length, truncated_by_limit: included.length > limit, excluded_count: excluded.length, excluded };
}

/** A bulk action may only be applied with the exact count the reviewer was shown. */
export function confirmBulk(plan, confirmedCount) {
  if (confirmedCount !== plan.preview_count) throw new Error(`confirmed count ${confirmedCount} differs from previewed ${plan.preview_count}`);
  return { ...plan, confirmed: true };
}

/** Undo information: previous status of each affected candidate, so the whole action can be reverted as a unit. */
export function bulkUndoRecord(plan, previousStatus) {
  return { action: plan.action, items: plan.ids.map((id) => ({ project_id: id, previous_status: previousStatus.get(id) })) };
}
