#!/usr/bin/env node
// Stage 5 — eligibility classification + dataset outputs.
//   node tools/upstream-import/classify.mjs --out data/upstream-import
// Implements reports/submission-eligibility-criteria.md literally; rule IDs are attached to every result.
// Deterministic: no LLM, no network, no execution.
// Requires: dedup/projects.jsonl (dedup.mjs --enrichment ...), enrichment/repos.jsonl, normalized/normalized.jsonl,
//           enrichment/official-registry.jsonl (strongly recommended; completeness is read from logs/registry-*.log),
//           raw/*.jsonl (for removal-like comments and source-number gaps).

import path from "node:path";
import fs from "node:fs";
import { parseArgs } from "node:util";
import { readJsonl, writeJsonlAtomic, writeJsonlPublicPrivate, writeJsonAtomic, ensureDir, readJson, writeCsv } from "./lib/store.mjs";
import { repoKeyOnly } from "./lib/urls.mjs";

const BLOCKING_AMBIGUITY = new Set(["same_repo_incompatible_names", "multiple_keys_merged", "shared_package_across_repos", "shared_endpoint_across_repos"]);
const STALE_MONTHS = 18;
const BULK_THRESHOLD = 25;
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const isSubpathKey = (key) => key.startsWith("github.com/") && key.split("/").length > 3;

export function buildRegistryIndex(entries) {
  const byRepo = new Map(), byEp = new Map(), byPkg = new Map();
  const add = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const e of entries) {
    add(byRepo, e.repository_key, e);
    for (const r of e.remotes || []) add(byEp, r.key, e);
    for (const p of e.packages || []) {
      if (p.registry === "npm") add(byPkg, `npm:${String(p.id).toLowerCase()}`, e);
      if (p.registry === "pypi") add(byPkg, `pypi:${String(p.id).toLowerCase().replace(/[-_.]+/g, "-")}`, e);
    }
  }
  return { byRepo, byEp, byPkg };
}

/**
 * Official-registry matches, split by how trustworthy the link is:
 *  - viaPackageOrEndpoint: package or remote-endpoint match. The registry verifies package ownership and
 *    (for custom-domain namespaces) domain control, so these are independent evidence.
 *  - viaRepoOwnerNamespace: repo URL match AND the registry name is in the repo owner's own `io.github.<owner>/`
 *    namespace (namespace authentication ties the name to that GitHub account).
 *  - repoClaimOnly: the entry merely *declares* this repository URL (self-declared metadata) -> weak.
 */
export function registryMatches(project, idx) {
  const viaPackageOrEndpoint = new Set(), viaRepoOwnerNamespace = new Set(), repoClaimOnly = new Set();
  const c = project.merged_claims;
  if (project.identity_type === "github_repo") {
    const base = repoKeyOnly(project.canonical_key);
    const owner = base.split("/")[1];
    const sub = project.canonical_key.split("/").slice(3).join("/") || null;
    for (const e of idx.byRepo.get(base) || []) {
      const es = (e.repository_subfolder || "").toLowerCase().replace(/^\/+|\/+$/g, "") || null;
      if (sub && es && es !== sub) continue;
      const ns = String(e.name).toLowerCase();
      if (ns.startsWith(`io.github.${owner}/`) || ns.startsWith(`com.github.${owner}/`)) viaRepoOwnerNamespace.add(e.name);
      else repoClaimOnly.add(e.name);
    }
  }
  for (const u of c.endpoints) {
    try { const x = new URL(u); const k = `endpoint:${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, "").toLowerCase()}`; for (const e of idx.byEp.get(k) || []) viaPackageOrEndpoint.add(e.name); } catch { /* ignore */ }
  }
  for (const id of c.package_ids) for (const e of idx.byPkg.get(id) || []) viaPackageOrEndpoint.add(e.name);
  return { viaPackageOrEndpoint: [...viaPackageOrEndpoint], viaRepoOwnerNamespace: [...viaRepoOwnerNamespace], repoClaimOnly: [...repoClaimOnly] };
}

function monthsBetween(a, b) { return (Date.parse(b) - Date.parse(a)) / (1000 * 60 * 60 * 24 * 30.44); }

export function classifyProject(p, repoInfo, reg, { collectedAt, bulkAuthors }) {
  const reasons = [];
  const why = (rule, detail) => reasons.push({ rule, detail });
  const c = p.merged_claims;
  const isRepo = p.identity_type === "github_repo";
  const info = isRepo ? repoInfo : null;
  const resolved = !!info?.resolved;
  const isSub = isRepo && isSubpathKey(p.canonical_key);
  const scope = isSub ? "subpath" : "root";

  // Registry evidence usable for this project. For an unresolved repository only package/endpoint matches count.
  const regVerified = resolved ? [...reg.viaPackageOrEndpoint, ...reg.viaRepoOwnerNamespace] : [...reg.viaPackageOrEndpoint];

  // E2 evidence: registry-manifest signals suffice; an SDK dependency also needs server wording from the SAME scope.
  const strong = [], weak = [], sdkSignals = [];
  if (resolved) {
    for (const e of info.sdk_evidence || []) {
      if (e.scope !== scope) continue; // root evidence never counts for a subpath project, and vice versa
      const label = `${e.scope}:${e.signal}`;
      if (/server\.json|mcpName/.test(e.signal)) strong.push(label); else sdkSignals.push(label);
    }
  }
  if (regVerified.length) strong.push(`official-registry:${regVerified[0]}${regVerified.length > 1 ? `(+${regVerified.length - 1})` : ""}`);
  else if (reg.repoClaimOnly.length) weak.push(`registry-entry-declares-this-repo(unverified):${reg.repoClaimOnly[0]}`);
  const serverWording = resolved ? (isSub ? info.server_wording_subpath : info.server_wording) || [] : [];
  if (sdkSignals.length && serverWording.length) strong.push(...sdkSignals, `server-wording:${serverWording[0]}`);
  else if (sdkSignals.length) weak.push(`sdk-dependency-without-server-wording:${sdkSignals[0]}`);
  if (resolved) {
    if (info.mcp_topics?.length) weak.push(`topic:${info.mcp_topics[0]}`);
    if ((isSub ? info.subpath_readme_mcp_mention : info.readme_mcp_mention)) weak.push("readme-mention");
    if (info.description_mentions_mcp) weak.push("repo-description-mention");
    if (/mcp|model-context/i.test(info.name_with_owner?.split("/")[1] || "")) weak.push("repo-name");
  }

  const readmeBytes = resolved ? (isSub ? info.subpath_readme_bytes || 0 : info.readme_bytes || 0) : 0;
  const hasAccessRoute = c.package_ids.length || c.install_command || c.endpoints.length || readmeBytes >= 500;
  const description = c.description || (resolved ? info.description : null);
  const usefulness = !!(c.name && description && description.length >= 20 && hasAccessRoute);
  const blocking = p.ambiguity_flags.filter((f) => BLOCKING_AMBIGUITY.has(f.code));

  let category;
  // --- Ineligible ---
  if (isRepo && /^github\.com\/chatmcp\//.test(p.canonical_key)) { category = "ineligible"; why("I1", "upstream registry infrastructure repository"); }
  else if (resolved && (info.empty || info.template) && !c.endpoints.length && !c.package_ids.length && !regVerified.length) { category = "ineligible"; why("I2", info.empty ? "repository is empty" : "template repository"); }
  else if (resolved && !isSub && !info.empty && info.readme_bytes >= 200 && !strong.length && !weak.length && !c.endpoints.length && !c.package_ids.length) { category = "ineligible"; why("I3", "no MCP signal in manifests, topics, README, description or name; no endpoint/package claimed"); }
  // --- Eligible ---
  else if ((resolved || regVerified.length) && strong.length) {
    const e1 = resolved ? "E1" : "E1b";
    const forkOf = resolved && info.fork ? info.fork_parent : null;
    const subMissing = resolved && isSub && info.subpath_exists === false;
    const ownerChanged = resolved && info.renamed && String(info.requested).split("/")[0].toLowerCase() !== String(info.name_with_owner).split("/")[0].toLowerCase();
    if (forkOf && !regVerified.length) { category = "needs_review"; why("N4", `fork of ${forkOf}`); }
    else if (subMissing) { category = "needs_review"; why("N5", "claimed subpath does not exist in repository"); }
    else if (blocking.length) { category = "needs_review"; for (const b of blocking) why("N6", `${b.code}: ${b.detail.slice(0, 120)}`); }
    else if (!usefulness) { category = "needs_review"; why("N7", `insufficient listing information (name:${!!c.name} description:${!!description} access-route:${!!hasAccessRoute})`); }
    else if (ownerChanged) { category = "needs_review"; why("N9", `repository transferred to a different owner: ${info.requested} -> ${info.name_with_owner}`); }
    else {
      category = "eligible"; why(e1, resolved ? "repository resolves" : "matched to official registry by package/endpoint");
      why("E2", strong.slice(0, 3).join(", ")); why("E3", "name, description and access route present"); why("E4", "not a fork; no blocking ambiguity");
    }
  }
  // --- Needs review ---
  else if (isRepo && !resolved) { category = "needs_review"; why("N2", `repository not resolvable (${info?.reason || "not looked up"})`); }
  else if (isRepo && resolved && weak.length) { category = "needs_review"; why("N1", `only weak MCP signals: ${weak.join(", ")}`); }
  else if (isRepo && resolved) { category = "needs_review"; why("N8", isSub ? "no evidence at the claimed subpath" : "no SDK evidence and README too short to judge"); }
  else { category = "needs_review"; why("N3", `no repository; ${c.endpoints.length ? "remote endpoint" : "package"} only and not in the official registry`); }

  const security_concern = p.security_flags.length > 0;

  // --- Informational quality indicators ---
  const q = [];
  const lic = resolved ? info.license_spdx : null;
  if (isRepo && resolved && (!lic || lic === "NOASSERTION") && !c.license) q.push("missing_license");
  else if (isRepo && resolved && (!lic || lic === "NOASSERTION")) q.push("license_unverified_claim_only");
  else if (!isRepo && !c.license) q.push("missing_license");
  if (resolved && info.archived) q.push("archived");
  if (resolved && info.pushed_at && monthsBetween(info.pushed_at, collectedAt) > STALE_MONTHS) q.push("stale");
  if (!c.package_ids.length && !c.install_command && !c.endpoints.length) q.push("missing_install_info");
  if (!description || !(c.license || lic) || !(c.package_ids.length || c.install_command || c.endpoints.length) || !c.hosting) q.push("incomplete_metadata");
  if (p.authors.some((a) => bulkAuthors.has(a))) q.push("bulk_submitter");
  if (p.submitted_by_repo_owner === false) q.push("not_submitted_by_repo_owner");
  if (p.upstream_states.length && p.upstream_states.every((s) => s.endsWith("closed/not_planned"))) q.push("upstream_closed_not_planned");
  if (p.quality_flags.includes("tools_not_listed")) q.push("tools_not_listed");
  if (regVerified.length) q.push("listed_in_official_registry");
  if (resolved && info.renamed) q.push("renamed");
  if (c.restricted_endpoints_claimed?.length) q.push("loopback_or_restricted_endpoint_documented");

  const evidenceKinds = new Set(strong.map((s) => (/official-registry/.test(s) ? "registry" : /server\.json|mcpName/.test(s) ? "manifest-file" : /server-wording/.test(s) ? "wording" : "sdk-dependency")));
  return {
    project_id: p.project_id, canonical_key: p.canonical_key, category, reasons, security_concern,
    security_flags: p.security_flags.map((f) => f.code), evidence_strong: strong, evidence_weak: weak,
    evidence_kinds: [...evidenceKinds].sort(),
    official_registry_matches: regVerified, official_registry_unverified_repo_claims: reg.repoClaimOnly,
    quality_indicators: q,
    // Three separate concepts: importable (stored with provenance, not suppressed), eligible (category), approved_for_publication (human + gates; never set by the pipeline).
    importable: true,
    eligible_unblocked: category === "eligible" && !security_concern,
    approved_for_publication: false,
    repo: resolved ? { name_with_owner: info.name_with_owner, archived: info.archived, fork: info.fork, stars: info.stars, pushed_at: info.pushed_at, license: lic, language: info.primary_language, evaluated_subpath: info.evaluated_subpath ?? null } : (isRepo ? { unresolved_reason: info?.reason || "not_looked_up" } : null),
  };
}

/**
 * Holds never delete or publish anything:
 *  - removal hold: the project may still be stored (importable) but is not eligible_unblocked until a human decides;
 *  - suppression (re-import prevention): the canonical key is on the suppression list, so it is neither importable nor eligible_unblocked.
 * Neither can be bypassed by a later step: bulk approval only ever selects eligible_unblocked rows.
 */
export function applyHolds(rows, { removalHold = new Set(), suppressedKeys = new Set() } = {}) {
  return rows.map((r) => {
    const suppressed = suppressedKeys.has(r.canonical_key);
    const held = removalHold.has(r.project_id);
    if (!suppressed && !held) return r;
    return {
      ...r,
      importable: r.importable && !suppressed,
      eligible_unblocked: false,
      approved_for_publication: false,
      quality_indicators: [...r.quality_indicators, ...(held ? ["removal_request_pending"] : []), ...(suppressed ? ["suppressed"] : [])],
    };
  });
}

/** Parse a suppression list: first CSV column is the canonical key; header row and blank lines ignored. */
export function parseSuppressionList(text) {
  return new Set(text.split("\n").map((l) => l.split(",")[0].trim().replace(/^"|"$/g, "")).filter((k) => k && k !== "canonical_key"));
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

function latestRegistryRun(out) {
  const dir = path.join(out, "logs");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("registry-")).sort();
  for (const f of files.reverse()) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n").reverse()) {
      if (line.includes('"registry_done"')) { try { return { file: f, ...JSON.parse(line) }; } catch { /* ignore */ } }
    }
  }
  return null;
}

export function main(argv = process.argv.slice(2)) {
  const { values: a } = parseArgs({ args: argv, options: { out: { type: "string", default: "data/upstream-import" }, suppression: { type: "string" } } });
  const out = path.resolve(a.out);
  const dir = path.join(out, "classified");
  ensureDir(dir);
  const projects = readJsonl(path.join(out, "dedup", "projects.jsonl"));
  const records = readJsonl(path.join(out, "normalized", "normalized.jsonl"));
  const enrichRows = readJsonl(path.join(out, "enrichment", "repos.jsonl"));
  const regFile = path.join(out, "enrichment", "official-registry.jsonl");
  const regEntries = fs.existsSync(regFile) ? readJsonl(regFile) : [];
  const regIdx = buildRegistryIndex(regEntries);
  const regRun = latestRegistryRun(out);
  const collect = readJson(path.join(out, "collect-manifest.json"), {});
  const collectedAt = collect.generated_at || new Date().toISOString();
  if (!regRun || regRun.truncated_by_page_cap) console.error("WARNING: official registry snapshot is missing or truncated; E1b/E2 matches are undercounted");

  const authorCounts = new Map();
  for (const p of projects) for (const au of p.authors) authorCounts.set(au, (authorCounts.get(au) || 0) + 1);
  const bulkAuthors = new Set([...authorCounts].filter(([, n]) => n >= BULK_THRESHOLD).map(([au]) => au));

  // Enrichment rows are keyed by the *requested* (pre-rename) key; projects carry the post-rename key.
  const byRequested = new Map(), byResolved = new Map();
  for (const e of enrichRows) {
    byRequested.set(e.requested_key, e);
    if (e.resolved) byResolved.set(`${e.canonical_key}${e.evaluated_subpath ? "/" + e.evaluated_subpath.toLowerCase() : ""}`, e);
  }
  const results = projects.map((p) => {
    const info = p.identity_type === "github_repo" ? (byRequested.get(p.canonical_key) || byResolved.get(p.canonical_key)) : null;
    return { p, r: classifyProject(p, info, registryMatches(p, regIdx), { collectedAt, bulkAuthors }) };
  });

  const rowsBase = results.map(({ p, r }) => ({
    ...r,
    name: p.merged_claims.name, description: p.merged_claims.description, repo_url: p.merged_claims.repo_url, homepage: p.merged_claims.homepage,
    endpoints: p.merged_claims.endpoints, package_ids: p.merged_claims.package_ids, install_command: p.merged_claims.install_command,
    hosting: p.merged_claims.hosting, transports: p.merged_claims.transports, license_claimed: p.merged_claims.license,
    source_count: p.source_count, source_issue_numbers: p.source_issue_numbers, authors: p.authors, first_seen: p.first_seen, last_seen: p.last_seen,
    ambiguity_flags: p.ambiguity_flags.map((f) => f.code), merge_reasons: p.merge_reasons.map((m) => m.rule),
  }));
  const removals = records.filter((r) => r.intent === "removal_request").map((r) => ({
    record_id: r.record_id, url: r.source.url, author: r.source.author_login, state: r.source.state,
    repo_keys: r.claims.repo_candidates.map((c) => c.key), mcp_so_slugs: r.claims.mcp_so_slugs,
  }));
  writeJsonlPublicPrivate(path.join(dir, "removal-requests.jsonl"), removals, ["author"]);
  // Candidate mapping to projects (NEVER auto-suppressed: manual confirmation required)
  const cand = [];
  for (const rm of removals) {
    for (const p of rowsBase) {
      const basis = [];
      if (rm.repo_keys.some((k) => repoKeyOnly(k) === repoKeyOnly(p.canonical_key))) basis.push("repo-url");
      const nameSlug = slugify(p.name), repoSlug = slugify(p.canonical_key.split("/")[2]);
      if (rm.mcp_so_slugs.some((s) => slugify(s) && (slugify(s) === nameSlug || slugify(s) === repoSlug))) basis.push("mcp.so-slug=name/repo");
      if (p.authors.some((au) => au === rm.author)) basis.push("same-author");
      if (basis.length && (basis.includes("repo-url") || basis.includes("mcp.so-slug=name/repo"))) cand.push({ removal_record: rm.record_id, removal_url: rm.url, requester: rm.author, project_id: p.project_id, canonical_key: p.canonical_key, name: p.name, match_basis: basis.join("+") });
      else if (basis.length === 1 && basis[0] === "same-author") cand.push({ removal_record: rm.record_id, removal_url: rm.url, requester: rm.author, project_id: p.project_id, canonical_key: p.canonical_key, name: p.name, match_basis: "same-author(weak)" });
    }
  }
  writeCsv(path.join(dir, "removal-candidates.csv"), ["removal_record", "removal_url", "requester", "project_id", "canonical_key", "name", "match_basis"], cand, { privateCols: ["requester"] });
  const removalsMapped = new Set(cand.filter((c) => !c.match_basis.includes("weak")).map((c) => c.removal_record));

  // Removal-like wording in comments outside the submission thread (authors may ask on their own issue)
  const rawComments = fs.existsSync(path.join(out, "raw", "issue_comments.jsonl")) ? readJsonl(path.join(out, "raw", "issue_comments.jsonl")) : [];
  const REMOVE_RE = /\b(?:please\s+)?(?:remove|delete|take\s*down|unlist|de-?list|withdraw)\b[^.\n]{0,60}\b(?:listing|server|entry|project|mcp\.so)\b|\bwithdraw(?:n|ing)?\b/i;
  const removalLike = rawComments.filter((c) => c.source_number !== 1 && REMOVE_RE.test(c.body || "")).map((c) => ({
    comment_url: c.source_url, parent_issue: c.source_number, author: c.author_login,
    project_ids: projects.filter((p) => p.source_issue_numbers.includes(c.source_number)).map((p) => p.project_id),
  }));
  writeCsv(path.join(dir, "removal-like-comments.csv"), ["comment_url", "parent_issue", "author", "project_ids"], removalLike, { privateCols: ["author"] });

  // Hold: any project a removal request may refer to (even weakly) or whose own issue carries removal-like wording
  // is NOT eligible_unblocked until a human decides. Never auto-suppressed, never auto-published.
  const removalHold = new Set([...cand.map((c) => c.project_id), ...removalLike.flatMap((c) => c.project_ids)]);
  const suppressedKeys = a.suppression && fs.existsSync(a.suppression) ? parseSuppressionList(fs.readFileSync(a.suppression, "utf8")) : new Set();
  const rows = applyHolds(rowsBase, { removalHold, suppressedKeys });
  writeJsonlAtomic(path.join(dir, "projects-classified.jsonl"), rows);
  const csvCols = ["project_id", "category", "importable", "eligible_unblocked", "approved_for_publication", "security_concern", "name", "canonical_key", "repo_url", "source_count", "first_seen", "hosting", "package_ids", "endpoints", "evidence_strong", "evidence_weak", "official_registry_matches", "quality_indicators", "security_flags", "ambiguity_flags"];
  writeCsv(path.join(dir, "projects-classified.csv"), csvCols, rows);
  const reasonRows = (r) => ({ ...r, reason_rules: r.reasons.map((x) => `${x.rule}: ${x.detail}`).join(" | ") });
  writeCsv(path.join(dir, "needs-review.csv"), ["project_id", "name", "canonical_key", "reason_rules", "source_issue_numbers", "ambiguity_flags", "evidence_weak"], rows.filter((r) => r.category === "needs_review").map(reasonRows));
  writeCsv(path.join(dir, "ambiguous-for-manual-review.csv"), ["project_id", "name", "canonical_key", "ambiguity_flags", "source_count", "source_issue_numbers", "authors"], rows.filter((r) => r.ambiguity_flags.some((f) => f !== "monorepo_subpath_project")), { privateCols: ["authors"] });
  const secRows = results.filter(({ r }) => r.security_concern).map(({ p, r }) => ({ project_id: r.project_id, name: p.merged_claims.name, canonical_key: r.canonical_key, category: r.category, flags: p.security_flags.map((f) => `${f.code} [${f.record_id}]: ${f.detail}`).join(" | "), source_issue_numbers: p.source_issue_numbers }));
  writeCsv(path.join(dir, "security-concerns.csv"), ["project_id", "name", "canonical_key", "category", "flags", "source_issue_numbers"], secRows);
  const unret = rows.filter((r) => r.repo?.unresolved_reason);
  writeCsv(path.join(dir, "unretrievable-repositories.csv"), ["project_id", "name", "canonical_key", "repo_url", "unresolved", "source_issue_numbers"], unret.map((r) => ({ ...r, unresolved: r.repo.unresolved_reason })));
  writeJsonlAtomic(path.join(dir, "eligible-unblocked.jsonl"), rows.filter((r) => r.eligible_unblocked));

  // ---- Record-level outputs ----
  const projOf = new Map();
  for (const p of projects) for (const id of p.source_record_ids) projOf.set(id, p);
  const dups = [];
  for (const p of projects) p.source_record_ids.slice(1).forEach((id) => dups.push({ record_id: id, duplicate_of_project: p.project_id, canonical_key: p.canonical_key, primary_record: p.source_record_ids[0] }));
  writeCsv(path.join(dir, "duplicate-source-records.csv"), ["record_id", "duplicate_of_project", "canonical_key", "primary_record"], dups);


  writeJsonlPublicPrivate(path.join(dir, "link-corrections.jsonl"), records.filter((r) => r.intent === "link_correction").map((r) => ({ record_id: r.record_id, url: r.source.url, author: r.source.author_login, repo_keys: r.claims.repo_candidates.map((c) => c.key), mcp_so_slugs: r.claims.mcp_so_slugs })), ["author"]);
  const nonSub = records.filter((r) => !projOf.has(r.record_id));
  const nonSubKind = (r) => (["submission", "submission_unclear"].includes(r.intent) ? "submission_without_identity" : r.intent);
  writeCsv(path.join(dir, "non-submission-records.csv"), ["record_id", "source_type", "url", "author", "intent", "reason"], nonSub.map((r) => ({ record_id: r.record_id, source_type: r.source.type, url: r.source.url, author: r.source.author_login, intent: nonSubKind(r), reason: r.intent_reason })), { privateCols: ["author"] });

  // Records that could not be retrieved: gaps in the issue/PR number sequence (deleted, transferred, or inaccessible) + API errors
  const rawIssues = readJsonl(path.join(out, "raw", "issues.jsonl")), rawPrs = readJsonl(path.join(out, "raw", "pull_requests.jsonl"));
  const present = new Set([...rawIssues, ...rawPrs].map((r) => r.source_number));
  const maxNum = Math.max(...present);
  const gaps = []; for (let n = 1; n <= maxNum; n++) if (!present.has(n)) gaps.push({ number: n, url: `https://github.com/${collect.repo || "chatmcp/mcpso"}/issues/${n}`, status: "not_returned_by_list_endpoints", note: "deleted, transferred, or inaccessible; cause not determinable from the list API" });
  const apiErrors = fs.existsSync(path.join(out, "raw", "errors.jsonl")) ? readJsonl(path.join(out, "raw", "errors.jsonl")) : [];
  writeCsv(path.join(dir, "unretrievable-source-records.csv"), ["number", "url", "status", "note"], [...gaps, ...apiErrors.map((e) => ({ number: e.source_number, url: "", status: `api_error:${e.status ?? ""}`, note: e.message }))]);

  // ---- Summary with denominators ----
  const N = rows.length;
  const cnt = (f) => rows.filter(f).length;
  const catOf = (list) => Object.fromEntries(["eligible", "needs_review", "ineligible"].map((k) => [k, list.filter((r) => r.category === k).length]));
  const resolvedN = cnt((r) => r.repo && !r.repo.unresolved_reason);
  const ghN = cnt((r) => r.canonical_key.startsWith("github.com/"));
  const eligible = rows.filter((r) => r.category === "eligible");
  const unresolvedByReason = unret.reduce((m, r) => ((m[r.repo.unresolved_reason] = (m[r.repo.unresolved_reason] || 0) + 1), m), {});
  const intents = records.reduce((m, r) => ((m[r.intent] = (m[r.intent] || 0) + 1), m), {});
  const submissionRecords = records.filter((r) => ["submission", "submission_unclear"].includes(r.intent));
  const summary = {
    generated_at: new Date().toISOString(), collected_at: collectedAt,
    official_registry: { entries_loaded: regEntries.length, complete: !!regRun && !regRun.truncated_by_page_cap, run: regRun ? { pages: regRun.pages, entries_seen: regRun.entries_seen, unique_servers: regRun.unique_servers, truncated_by_page_cap: regRun.truncated_by_page_cap, finished_at: regRun.ts } : null },
    record_level: {
      denominator_normalized_records: records.length,
      issues: collect.counts?.issues, pull_requests: collect.counts?.pull_requests, submission_thread_comments: records.filter((r) => r.source.in_submission_thread).length,
      by_intent: intents,
      submission_records: submissionRecords.length,
      submission_records_grouped_into_projects: projects.reduce((n, p) => n + p.source_count, 0),
      submission_records_without_identity: submissionRecords.length - projects.reduce((n, p) => n + p.source_count, 0),
      non_submission_records: records.length - submissionRecords.length,
      non_submission_breakdown: nonSub.reduce((m, r) => ((m[nonSubKind(r)] = (m[nonSubKind(r)] || 0) + 1), m), {}),
      duplicate_source_records: dups.length,
      issue_number_gaps: gaps.length,
    },
    project_level: {
      denominator_projects: N,
      category: catOf(rows),
      percent: { eligible: pct(eligible.length, N), needs_review: pct(cnt((r) => r.category === "needs_review"), N), ineligible: pct(cnt((r) => r.category === "ineligible"), N) },
      projects_with_multiple_sources: cnt((r) => r.source_count > 1),
      security_concern_projects: cnt((r) => r.security_concern),
      eligible_but_security_flagged: eligible.filter((r) => r.security_concern).length,
      importable: cnt((r) => r.importable),
      suppressed: cnt((r) => r.quality_indicators.includes("suppressed")),
      eligible_unblocked: cnt((r) => r.eligible_unblocked),
      approved_for_publication: cnt((r) => r.approved_for_publication),
      held_for_removal_review: cnt((r) => r.quality_indicators.includes("removal_request_pending")),
      eligible_held_for_removal_review: eligible.filter((r) => r.quality_indicators.includes("removal_request_pending")).length,
      // unit: reason ENTRIES (a project can carry several entries of one rule, e.g. N6 once per ambiguity flag)
      reason_rule_counts: rows.reduce((m, r) => { for (const x of r.reasons) m[x.rule] = (m[x.rule] || 0) + 1; return m; }, {}),
      // unit: distinct PROJECTS carrying the rule
      reason_rule_projects: rows.reduce((m, r) => { for (const x of new Set(r.reasons.map((y) => y.rule))) m[x] = (m[x] || 0) + 1; return m; }, {}),
      needs_review_by_first_rule: rows.filter((r) => r.category === "needs_review").reduce((m, r) => ((m[r.reasons[0].rule] = (m[r.reasons[0].rule] || 0) + 1), m), {}),
      ineligible_by_rule: rows.filter((r) => r.category === "ineligible").reduce((m, r) => ((m[r.reasons[0].rule] = (m[r.reasons[0].rule] || 0) + 1), m), {}),
      eligible_blocked: {
        security_flag_only: eligible.filter((r) => r.security_concern && !r.quality_indicators.includes("removal_request_pending")).length,
        removal_hold_only: eligible.filter((r) => !r.security_concern && r.quality_indicators.includes("removal_request_pending")).length,
        both: eligible.filter((r) => r.security_concern && r.quality_indicators.includes("removal_request_pending")).length,
      },
      eligible_by_evidence_kind: eligible.reduce((m, r) => { const k = r.evidence_kinds.join("+") || "none"; m[k] = (m[k] || 0) + 1; return m; }, {}),
      eligible_with_only_cheap_evidence: eligible.filter((r) => !r.evidence_kinds.includes("sdk-dependency")).length,
      bulk_submitter_authors: bulkAuthors.size,
      bulk_submitter_projects: { total: cnt((r) => r.quality_indicators.includes("bulk_submitter")), ...catOf(rows.filter((r) => r.quality_indicators.includes("bulk_submitter"))) },
      tools_not_listed_projects: { total: cnt((r) => r.quality_indicators.includes("tools_not_listed")), ...catOf(rows.filter((r) => r.quality_indicators.includes("tools_not_listed"))) },
    },
    repository_health: {
      denominator_github_projects: ghN, resolved: resolvedN, unresolved: unret.length, unresolved_by_reason: unresolvedByReason,
      renamed_or_transferred: cnt((r) => r.quality_indicators.includes("renamed")), archived: cnt((r) => r.quality_indicators.includes("archived")), stale: cnt((r) => r.quality_indicators.includes("stale")),
      missing_license_of_resolved: cnt((r) => r.quality_indicators.includes("missing_license") && r.repo && !r.repo.unresolved_reason),
    },
    metadata_completeness: {
      denominator_projects: N,
      missing_install_info: cnt((r) => r.quality_indicators.includes("missing_install_info")),
      incomplete_metadata: cnt((r) => r.quality_indicators.includes("incomplete_metadata")),
      listed_in_official_registry: cnt((r) => r.quality_indicators.includes("listed_in_official_registry")),
    },
    ambiguity: {
      ambiguous_projects: cnt((r) => r.ambiguity_flags.some((f) => f !== "monorepo_subpath_project")),
      ambiguous_projects_by_category: catOf(rows.filter((r) => r.ambiguity_flags.some((f) => f !== "monorepo_subpath_project"))),
      projects_with_N6_reason: cnt((r) => r.reasons.some((x) => x.rule === "N6")),
    },
    removals: { requests: removals.length, mapped_to_a_project_with_strong_basis: removalsMapped.size, unmapped: removals.length - removalsMapped.size, removal_like_comments_outside_thread: removalLike.length },
  };
  writeJsonAtomic(path.join(dir, "classification-summary.json"), summary);

  // ---- Import manifest tying the stages together ----
  const safe = (f, fb = null) => readJson(path.join(out, f), fb);
  const enrichChecked = enrichRows.map((e) => e.checked_at).filter(Boolean).sort();
  writeJsonAtomic(path.join(out, "import-manifest.json"), {
    generated_at: new Date().toISOString(),
    source_repository: collect.repo || "chatmcp/mcpso",
    stages: {
      collect: { finished_at: collect.generated_at, authenticated: collect.authenticated, counts: collect.counts, stages: collect.stages },
      normalize: safe("normalized/normalize-summary.json"),
      dedup: safe("dedup/dedup-summary.json"),
      enrichment: { records: enrichRows.length, first_checked_at: enrichChecked[0] ?? null, last_checked_at: enrichChecked[enrichChecked.length - 1] ?? null, unresolved_by_reason: unresolvedByReason },
      official_registry: summary.official_registry,
      classify: { generated_at: summary.generated_at, projects: N, category: summary.project_level.category },
    },
    runtime: { node: process.version },
    notes: ["raw/ is not committed; regenerate with tools/upstream-import/README.md", "classification categories are eligibility, not verification"],
  });
  console.error(JSON.stringify(summary, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
