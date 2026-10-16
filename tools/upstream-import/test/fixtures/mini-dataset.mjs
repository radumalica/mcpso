// Synthetic mini dataset in the exact file layout of data/upstream-import (no real third-party text). Used by the loader tests.
// Covers: duplicate records for one project, a security-flagged and a removal-held candidate, an ineligible endpoint project,
// every non-mapped disposition (no_identity, not_submission, code_contribution, context_comment, removal_request,
// link_correction) and an unresolved submission.
import fs from "node:fs";
import path from "node:path";

const REPO = "example/source";
const issue = (id, number, title, extra = {}) => ({
  source_repo: REPO, source_type: "issue", source_id: id, source_number: number, source_url: `https://example.test/issues/${number}`,
  author_login: `user${number}`, author_type: "User", created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z",
  state: "open", title, body: `synthetic body ${number}`, collected_at: "2026-01-01T00:00:00Z", ...extra,
});
const comment = (id, parent, extra = {}) => ({
  source_repo: REPO, source_type: "issue_comment", source_id: id, source_number: parent, source_url: `https://example.test/issues/${parent}#c${id}`,
  author_login: `user${id}`, created_at: "2025-01-02T00:00:00Z", updated_at: "2025-01-02T00:00:00Z", body: `synthetic comment ${id}`,
  collected_at: "2026-01-01T00:00:00Z", ...extra,
});
const pr = (id, number) => ({ ...issue(id, number, "synthetic change"), source_type: "pull_request", merged: false });

const KEY_A = "github.com/synthetic/alpha";
const KEY_B = "github.com/synthetic/beta";
const KEY_C = "endpoint:example.test/mcp";

export function miniDataset() {
  const raw = {
    issues: [
      issue(101, 1, "alpha"), issue(102, 2, "alpha again"), issue(103, 3, "beta"), issue(104, 4, "nothing here"),
      issue(105, 5, "a question"), issue(106, 6, "please remove alpha"), issue(107, 7, "unresolved"), issue(108, 8, "fix link"),
    ],
    pulls: [pr(201, 9)],
    comments: [comment(301, 1, { source_number: 1 }), comment(302, 50), comment(303, 51)],
  };
  const rec = (kind, r) => `${kind}:${r.source_id}`;
  const n = (id, intent, claims = {}, reason = null) => ({ record_id: id, intent, intent_reason: reason, source: {}, claims, security_flags: [], quality_flags: [] });
  const normalized = [
    n("issue:101", "submission"), n("issue:102", "submission"), n("issue:103", "submission"), n("comment:301", "submission"),
    n("issue:104", "no_identity", {}, "no repository, endpoint, package or homepage found"), n("issue:105", "question_or_feedback"),
    n("issue:106", "removal_request"), n("issue:107", "submission"), n("issue:108", "link_correction"), n("pr:201", "code_contribution"),
  ];
  const project = (id, key, type, ids, extra = {}) => ({ project_id: id, canonical_key: key, identity_type: type, source_record_ids: ids, merge_reasons: [], ...extra });
  const projects = [
    project("p_a", KEY_A, "github_repo", ["issue:101", "issue:102"]),
    project("p_b", KEY_B, "github_repo", ["issue:103"]),
    project("p_c", KEY_C, "endpoint", ["comment:301"], { merge_reasons: ["R4 endpoint"] }),
  ];
  const classified = [
    { project_id: "p_a", last_seen: "2026-09-01T00:00:00Z", repo: { name_with_owner: "Synthetic/alpha", archived: false, fork: false, license: "MIT", pushed_at: "2026-01-02T00:00:00Z" }, canonical_key: KEY_A, category: "eligible", reasons: [{ rule: "E1", detail: "synthetic" }], security_concern: false, security_flags: [],
      evidence_strong: ["sdk-dependency"], evidence_weak: [], evidence_kinds: ["sdk-dependency"], official_registry_matches: [], official_registry_unverified_repo_claims: [],
      quality_indicators: ["removal_request_pending"], importable: true, name: "alpha", repo_url: "https://example.test/alpha", authors: ["user1"], endpoints: [], package_ids: [], transports: [] },
    { project_id: "p_b", last_seen: "2026-09-02T00:00:00Z", repo_url: "https://example.test/beta", repo: { name_with_owner: "Synthetic/beta", archived: true, fork: false, license: null, pushed_at: "2025-01-02T00:00:00Z" }, canonical_key: KEY_B, category: "needs_review", reasons: [{ rule: "N1", detail: "synthetic" }], security_concern: true, security_flags: ["pipe_to_shell_install"],
      evidence_strong: [], evidence_weak: ["readme-mention"], evidence_kinds: [], official_registry_matches: [], official_registry_unverified_repo_claims: [],
      quality_indicators: [], importable: true, name: "beta", authors: ["user3"], endpoints: [], package_ids: [], transports: [] },
    { project_id: "p_c", last_seen: "2026-09-03T00:00:00Z", canonical_key: KEY_C, category: "ineligible", reasons: [{ rule: "I1", detail: "synthetic" }], security_concern: false, security_flags: [],
      evidence_strong: [], evidence_weak: [], evidence_kinds: [], official_registry_matches: [], official_registry_unverified_repo_claims: [],
      quality_indicators: [], ambiguity_flags: ["shared_endpoint_across_repos"], importable: true, name: "gamma", authors: [], endpoints: ["https://example.test/mcp"], package_ids: [], transports: ["http"] },
  ];
  const removals = [{ record_id: "issue:106", url: "https://example.test/issues/6", state: "open", repo_keys: [KEY_A], mcp_so_slugs: [] }];
  const linkCorrections = [{ record_id: "issue:108", url: "https://example.test/issues/8", repo_keys: [KEY_B, KEY_A], mcp_so_slugs: [] }]; // two keys: no single target
  const enrichment = [{ requested_key: KEY_A, resolved: true, checked_at: "2026-10-01T00:00:00.000Z", license_spdx: "MIT", pushed_at: "2026-01-02T00:00:00Z" }];
  return { raw, normalized, projects, classified, removals, linkCorrections, enrichment, unresolved: [{ record_id: "issue:107", url: "https://example.test/issues/7", intent: "submission" }], rec };
}

export function writeMiniDataset(dir, ds = miniDataset()) {
  const w = (rel, rows) => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  };
  w("raw/issues.jsonl", ds.raw.issues);
  w("raw/pull_requests.jsonl", ds.raw.pulls);
  w("raw/issue_comments.jsonl", ds.raw.comments);
  w("normalized/normalized.jsonl", ds.normalized);
  w("dedup/projects.jsonl", ds.projects);
  w("dedup/unresolved-submissions.jsonl", ds.unresolved);
  w("classified/projects-classified.jsonl", ds.classified);
  w("classified/removal-requests.jsonl", ds.removals);
  w("classified/link-corrections.jsonl", ds.linkCorrections);
  w("enrichment/repos.jsonl", ds.enrichment ?? []);
  return dir;
}

export const KEYS = { A: KEY_A, B: KEY_B, C: KEY_C };
