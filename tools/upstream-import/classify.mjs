#!/usr/bin/env node
// Stage 5 — eligibility classification + dataset outputs.
//   node tools/upstream-import/classify.mjs --out data/upstream-import
// Implements reports/submission-eligibility-criteria.md literally; rule IDs are
// attached to every result. Deterministic: no LLM, no network, no execution.
// Requires: dedup/projects.jsonl (run dedup.mjs --enrichment ...), enrichment/repos.jsonl,
//           enrichment/official-registry.jsonl (optional but strongly recommended).

import path from "node:path";
import fs from "node:fs";
import { parseArgs } from "node:util";
import { readJsonl, writeJsonlAtomic, writeJsonAtomic, ensureDir, readJson } from "./lib/store.mjs";
import { repoKeyOnly } from "./lib/urls.mjs";

const BLOCKING_AMBIGUITY = new Set(["same_repo_incompatible_names", "multiple_keys_merged", "shared_package_across_repos", "shared_endpoint_across_repos"]);
const STALE_MONTHS = 18;
const BULK_THRESHOLD = 25;

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

export function registryMatches(project, idx) {
  const names = new Set();
  const c = project.merged_claims;
  if (project.identity_type === "github_repo") {
    const base = repoKeyOnly(project.canonical_key);
    const sub = project.canonical_key.split("/").slice(3).join("/") || null;
    for (const e of idx.byRepo.get(base) || []) {
      const es = (e.repository_subfolder || "").toLowerCase().replace(/^\/+|\/+$/g, "") || null;
      if (!sub || !es || es === sub) names.add(e.name);
    }
  }
  for (const u of c.endpoints) { try { const x = new URL(u); const k = `endpoint:${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, "").toLowerCase()}`; for (const e of idx.byEp.get(k) || []) names.add(e.name); } catch { /* ignore */ } }
  for (const id of c.package_ids) for (const e of idx.byPkg.get(id) || []) names.add(e.name);
  return [...names];
}

function monthsBetween(a, b) { return (Date.parse(b) - Date.parse(a)) / (1000 * 60 * 60 * 24 * 30.44); }

export function classifyProject(p, repoInfo, regMatches, { collectedAt, bulkAuthors }) {
  const reasons = [];
  const why = (rule, detail) => reasons.push({ rule, detail });
  const c = p.merged_claims;
  const isRepo = p.identity_type === "github_repo";
  const info = isRepo ? repoInfo : null;
  const resolved = !!info?.resolved;
  // E2: registry-manifest signals (server.json / mcpName / official-registry match) are sufficient on their own;
  // an SDK dependency proves MCP involvement but not "is a server", so it also needs server wording
  // (topic, description or README saying "MCP server"). The submitter's own wording is never used.
  const strong = [];
  const weak = [];
  const sdkSignals = [];
  if (resolved) {
    for (const e of info.sdk_evidence || []) {
      const label = `${e.scope}:${e.signal}`;
      if (/server\.json|mcpName/.test(e.signal)) strong.push(label); else sdkSignals.push(label);
    }
  }
  if (regMatches.length) strong.push(`official-registry:${regMatches[0]}${regMatches.length > 1 ? `(+${regMatches.length - 1})` : ""}`);
  const serverWording = resolved ? info.server_wording || [] : [];
  if (sdkSignals.length && serverWording.length) strong.push(...sdkSignals, `server-wording:${serverWording[0]}`);
  else if (sdkSignals.length) weak.push(`sdk-dependency-without-server-wording:${sdkSignals[0]}`);
  if (resolved) {
    if (info.mcp_topics?.length) weak.push(`topic:${info.mcp_topics[0]}`);
    if (info.readme_mcp_mention) weak.push("readme-mention");
    if (info.description_mentions_mcp) weak.push("repo-description-mention");
    if (/mcp|model-context/i.test(info.name_with_owner?.split("/")[1] || "")) weak.push("repo-name");
  }
  const hasAccessRoute = c.package_ids.length || c.install_command || c.endpoints.length || (resolved && info.readme_bytes >= 500);
  const description = c.description || (resolved ? info.description : null);
  const usefulness = !!(c.name && description && description.length >= 20 && hasAccessRoute);
  const blocking = p.ambiguity_flags.filter((f) => BLOCKING_AMBIGUITY.has(f.code));

  let category;
  // --- Ineligible ---
  if (isRepo && /^github\.com\/chatmcp\//.test(p.canonical_key)) { category = "ineligible"; why("I1", "upstream registry infrastructure repository"); }
  else if (resolved && (info.empty || info.template) && !c.endpoints.length && !c.package_ids.length && !regMatches.length) { category = "ineligible"; why("I2", info.empty ? "repository is empty" : "template repository"); }
  else if (resolved && !info.empty && info.readme_bytes >= 200 && !strong.length && !weak.length && !c.endpoints.length && !c.package_ids.length) { category = "ineligible"; why("I3", "no MCP signal in manifests, topics, README, description or name; no endpoint/package claimed"); }
  // --- Eligible ---
  else if ((resolved || regMatches.length) && strong.length) {
    const e1 = resolved ? "E1" : "E1b";
    const forkOf = resolved && info.fork ? info.fork_parent : null;
    const subMissing = resolved && p.canonical_key.split("/").length > 3 && info.subpath_exists === false;
    if (forkOf && !regMatches.length) { category = "needs_review"; why("N4", `fork of ${forkOf}`); }
    else if (subMissing) { category = "needs_review"; why("N5", "claimed subpath does not exist in repository"); }
    else if (blocking.length) { category = "needs_review"; for (const b of blocking) why("N6", `${b.code}: ${b.detail.slice(0, 120)}`); }
    else if (!usefulness) { category = "needs_review"; why("N7", `insufficient listing information (name:${!!c.name} description:${!!description} access-route:${!!hasAccessRoute})`); }
    else {
      category = "eligible"; why(e1, resolved ? "repository resolves" : "matched to official registry");
      why("E2", strong.slice(0, 3).join(", ")); why("E3", "name, description and access route present"); why("E4", "not a fork; no blocking ambiguity");
    }
    const ownerChanged = resolved && info.renamed && String(info.requested).split("/")[0].toLowerCase() !== String(info.name_with_owner).split("/")[0].toLowerCase();
    if (ownerChanged && category === "eligible") { category = "needs_review"; why("N9", `repository transferred to a different owner: ${info.requested} -> ${info.name_with_owner}`); }
  }
  // --- Needs review ---
  else if (isRepo && !resolved) { category = "needs_review"; why("N2", `repository not resolvable (${info?.reason || "not looked up"})`); }
  else if (isRepo && resolved && weak.length) { category = "needs_review"; why("N1", `only weak MCP signals: ${weak.join(", ")}`); }
  else if (isRepo && resolved) { category = "needs_review"; why("N8", "no SDK evidence and README too short to judge"); }
  else { category = "needs_review"; why("N3", `no repository; ${c.endpoints.length ? "remote endpoint" : "package"} only and not in the official registry`); }

  // --- Independent security flag ---
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
  if (regMatches.length) q.push("listed_in_official_registry");
  if (resolved && info.renamed) q.push("renamed");

  return {
    project_id: p.project_id, canonical_key: p.canonical_key, category, reasons, security_concern,
    security_flags: p.security_flags.map((f) => f.code), evidence_strong: strong, evidence_weak: weak,
    official_registry_matches: regMatches, quality_indicators: q,
    import_ready: category === "eligible" && !security_concern,
    repo: resolved ? { name_with_owner: info.name_with_owner, archived: info.archived, fork: info.fork, stars: info.stars, pushed_at: info.pushed_at, license: lic, language: info.primary_language } : (isRepo ? { unresolved_reason: info?.reason || "not_looked_up" } : null),
  };
}

const csvEsc = (v) => { const s = Array.isArray(v) ? v.join("; ") : v ?? ""; return /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s); };
const writeCsv = (file, cols, rows) => fs.writeFileSync(file, [cols.join(","), ...rows.map((r) => cols.map((c) => csvEsc(r[c])).join(","))].join("\n") + "\n");
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

export function main(argv = process.argv.slice(2)) {
  const { values: a } = parseArgs({ args: argv, options: { out: { type: "string", default: "data/upstream-import" } } });
  const out = path.resolve(a.out);
  const dir = path.join(out, "classified");
  ensureDir(dir);
  const projects = readJsonl(path.join(out, "dedup", "projects.jsonl"));
  const records = readJsonl(path.join(out, "normalized", "normalized.jsonl"));
  const enrich = new Map(readJsonl(path.join(out, "enrichment", "repos.jsonl")).map((r) => [r.requested_key, r]));
  const regFile = path.join(out, "enrichment", "official-registry.jsonl");
  const regEntries = fs.existsSync(regFile) ? readJsonl(regFile) : [];
  const regIdx = buildRegistryIndex(regEntries);
  const collect = readJson(path.join(out, "collect-manifest.json"), {});
  const collectedAt = collect.generated_at || new Date().toISOString();

  const authorCounts = new Map();
  for (const p of projects) for (const au of p.authors) authorCounts.set(au, (authorCounts.get(au) || 0) + 1);
  const bulkAuthors = new Set([...authorCounts].filter(([, n]) => n >= BULK_THRESHOLD).map(([au]) => au));

  // Enrichment is keyed by the *requested* (pre-rename) base repo key; the project key may be post-rename.
  const enrichByResolved = new Map();
  for (const e of enrich.values()) if (e.resolved) enrichByResolved.set(e.canonical_key, e);
  const results = projects.map((p) => {
    const base = p.identity_type === "github_repo" ? repoKeyOnly(p.canonical_key) : null;
    const info = base ? (enrich.get(base) || enrichByResolved.get(base)) : null;
    const reg = registryMatches(p, regIdx);
    return { p, r: classifyProject(p, info, reg, { collectedAt, bulkAuthors }) };
  });

  const rows = results.map(({ p, r }) => ({
    ...r,
    name: p.merged_claims.name, description: p.merged_claims.description, repo_url: p.merged_claims.repo_url, homepage: p.merged_claims.homepage,
    endpoints: p.merged_claims.endpoints, package_ids: p.merged_claims.package_ids, install_command: p.merged_claims.install_command,
    hosting: p.merged_claims.hosting, transports: p.merged_claims.transports, license_claimed: p.merged_claims.license,
    source_count: p.source_count, source_issue_numbers: p.source_issue_numbers, authors: p.authors, first_seen: p.first_seen, last_seen: p.last_seen,
    ambiguity_flags: p.ambiguity_flags.map((f) => f.code), merge_reasons: p.merge_reasons.map((m) => m.rule),
  }));
  writeJsonlAtomic(path.join(dir, "projects-classified.jsonl"), rows);
  const csvCols = ["project_id", "category", "import_ready", "security_concern", "name", "canonical_key", "repo_url", "source_count", "first_seen", "hosting", "package_ids", "endpoints", "evidence_strong", "evidence_weak", "official_registry_matches", "quality_indicators", "security_flags", "ambiguity_flags"];
  writeCsv(path.join(dir, "projects-classified.csv"), csvCols, rows.map((r) => ({ ...r, reasons: r.reasons.map((x) => x.rule) })));
  const reasonRows = (r) => ({ ...r, reason_rules: r.reasons.map((x) => `${x.rule}: ${x.detail}`).join(" | ") });
  writeCsv(path.join(dir, "needs-review.csv"), ["project_id", "name", "canonical_key", "reason_rules", "source_issue_numbers", "ambiguity_flags", "evidence_weak"], rows.filter((r) => r.category === "needs_review").map(reasonRows));
  writeCsv(path.join(dir, "ambiguous-for-manual-review.csv"), ["project_id", "name", "canonical_key", "ambiguity_flags", "source_count", "source_issue_numbers", "authors"], rows.filter((r) => r.ambiguity_flags.some((f) => f !== "monorepo_subpath_project")));
  const secRows = results.filter(({ r }) => r.security_concern).map(({ p, r }) => ({ project_id: r.project_id, name: p.merged_claims.name, canonical_key: r.canonical_key, category: r.category, flags: p.security_flags.map((f) => `${f.code} [${f.record_id}]: ${f.detail}`).join(" | "), source_issue_numbers: p.source_issue_numbers }));
  writeCsv(path.join(dir, "security-concerns.csv"), ["project_id", "name", "canonical_key", "category", "flags", "source_issue_numbers"], secRows);
  const unret = rows.filter((r) => r.repo?.unresolved_reason);
  writeCsv(path.join(dir, "unretrievable-repositories.csv"), ["project_id", "name", "canonical_key", "repo_url", "source_issue_numbers"], unret.map((r) => ({ ...r, unresolved: r.repo.unresolved_reason })));
  writeJsonlAtomic(path.join(dir, "import-ready.jsonl"), rows.filter((r) => r.import_ready));

  // Record-level outputs
  const projOf = new Map();
  for (const p of projects) for (const id of p.source_record_ids) projOf.set(id, p);
  const dups = [];
  for (const p of projects) p.source_record_ids.slice(1).forEach((id) => dups.push({ record_id: id, duplicate_of_project: p.project_id, canonical_key: p.canonical_key, primary_record: p.source_record_ids[0] }));
  writeCsv(path.join(dir, "duplicate-source-records.csv"), ["record_id", "duplicate_of_project", "canonical_key", "primary_record"], dups);
  const removals = records.filter((r) => r.intent === "removal_request").map((r) => ({ record_id: r.record_id, url: r.source.url, author: r.source.author_login, state: r.source.state, title_hint: r.claims.name, repo_keys: r.claims.repo_candidates.map((c) => c.key), mcp_so_slugs: r.claims.mcp_so_slugs }));
  writeJsonlAtomic(path.join(dir, "removal-requests.jsonl"), removals);
  writeJsonlAtomic(path.join(dir, "link-corrections.jsonl"), records.filter((r) => r.intent === "link_correction").map((r) => ({ record_id: r.record_id, url: r.source.url, author: r.source.author_login, repo_keys: r.claims.repo_candidates.map((c) => c.key) })));
  const nonSub = records.filter((r) => !["submission", "submission_unclear"].includes(r.intent) || !projOf.has(r.record_id));
  writeCsv(path.join(dir, "non-submission-records.csv"), ["record_id", "source_type", "url", "author", "intent", "reason"], nonSub.map((r) => ({ record_id: r.record_id, source_type: r.source.type, url: r.source.url, author: r.source.author_login, intent: projOf.has(r.record_id) ? r.intent : (["submission", "submission_unclear"].includes(r.intent) ? "submission_without_identity" : r.intent), reason: r.intent_reason })));

  // Suppression: projects whose repo is named in a removal request
  const removalKeys = new Set(removals.flatMap((r) => r.repo_keys.map(repoKeyOnly)));
  const suppressed = rows.filter((r) => r.canonical_key.startsWith("github.com/") && removalKeys.has(repoKeyOnly(r.canonical_key)));

  // Summary with denominators
  const N = rows.length;
  const cnt = (f) => rows.filter(f).length;
  const resolvedN = cnt((r) => r.repo && !r.repo.unresolved_reason);
  const ghN = cnt((r) => r.canonical_key.startsWith("github.com/"));
  const summary = {
    generated_at: new Date().toISOString(), collected_at: collectedAt,
    source_records: { issues: collect.counts?.issues, pull_requests: collect.counts?.pull_requests, issue_comments_collected: collect.counts?.issue_comments, normalized_records: records.length, by_intent: records.reduce((m, r) => ((m[r.intent] = (m[r.intent] || 0) + 1), m), {}) },
    submission_records_grouped: projects.reduce((n, p) => n + p.source_count, 0),
    projects: N, duplicate_source_records: dups.length,
    projects_with_multiple_sources: cnt((r) => r.source_count > 1),
    category: Object.fromEntries(["eligible", "needs_review", "ineligible"].map((k) => [k, cnt((r) => r.category === k)])),
    security_concern_projects: cnt((r) => r.security_concern),
    import_ready: cnt((r) => r.import_ready),
    eligible_but_security_flagged: cnt((r) => r.category === "eligible" && r.security_concern),
    reason_rule_counts: rows.reduce((m, r) => { for (const x of r.reasons) m[x.rule] = (m[x.rule] || 0) + 1; return m; }, {}),
    github_projects: ghN, github_repos_resolved: resolvedN, github_repos_unresolved: unret.length,
    renamed: cnt((r) => r.quality_indicators.includes("renamed")),
    archived: cnt((r) => r.quality_indicators.includes("archived")), stale: cnt((r) => r.quality_indicators.includes("stale")),
    missing_license_of_resolved: cnt((r) => r.quality_indicators.includes("missing_license") && r.repo && !r.repo.unresolved_reason),
    missing_install_info: cnt((r) => r.quality_indicators.includes("missing_install_info")),
    incomplete_metadata: cnt((r) => r.quality_indicators.includes("incomplete_metadata")),
    listed_in_official_registry: cnt((r) => r.quality_indicators.includes("listed_in_official_registry")),
    bulk_submitter_projects: cnt((r) => r.quality_indicators.includes("bulk_submitter")), bulk_submitter_authors: bulkAuthors.size,
    ambiguous_projects: cnt((r) => r.ambiguity_flags.some((f) => f !== "monorepo_subpath_project")),
    official_registry_entries_loaded: regEntries.length,
    removal_requests: removals.length, projects_matched_by_removal_requests: suppressed.map((r) => r.project_id),
    denominators: { projects: N, github_projects: ghN, github_resolved: resolvedN },
    percent: { eligible: pct(cnt((r) => r.category === "eligible"), N), needs_review: pct(cnt((r) => r.category === "needs_review"), N), ineligible: pct(cnt((r) => r.category === "ineligible"), N) },
  };
  writeJsonAtomic(path.join(dir, "classification-summary.json"), summary);
  console.error(JSON.stringify(summary, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
