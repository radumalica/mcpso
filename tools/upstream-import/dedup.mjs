#!/usr/bin/env node
// Stage 3 — group submission records into canonical projects (non-destructive).
//   node tools/upstream-import/dedup.mjs --out data/upstream-import [--enrichment <file>]
//
// Merge policy (every merge records its reason; nothing is merged on name or
// description similarity):
//   R1  same canonical repository key (github.com/owner/repo[/subpath])
//   R2  record has no repo but shares a package id with exactly ONE repo-keyed project
//   R3  record has no repo but shares a remote endpoint key with exactly ONE repo-keyed project
//   R4  records without any repo/package share an identical endpoint key (non-GitHub projects)
//   R5  records without any repo/endpoint share an identical package id
//   R6  (only with --enrichment) GitHub resolves the repo to a different canonical
//       owner/name -> rename/transfer evidence; the projects are merged.
// Ambiguities are *flagged, not merged*: shared package/endpoint across different
// repos (forks / re-publishers), repo-level vs subpath overlap, same-repo records
// with unrelated names (monorepo or collision).

import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { readJsonl, writeJsonlAtomic, writeJsonlPublicPrivate, ensureDir, writeJsonAtomic, readJson } from "./lib/store.mjs";
import { repoKeyOnly } from "./lib/urls.mjs";
import fs from "node:fs";

const SUBMISSION_INTENTS = new Set(["submission", "submission_unclear"]);
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const pid = (key) => `p_${crypto.createHash("sha1").update(key).digest("hex").slice(0, 12)}`;

class UnionFind {
  constructor() { this.p = new Map(); }
  find(x) { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r); this.p.set(x, r); return r; }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(rb, ra); }
}

function namesCompatible(a, b) {
  const x = slug(a), y = slug(b);
  if (!x || !y) return true;
  return x.includes(y) || y.includes(x) || x.slice(0, 5) === y.slice(0, 5);
}

export function buildProjects(records, { renames = new Map() } = {}) {
  const subs = records.filter((r) => SUBMISSION_INTENTS.has(r.intent) && (r.claims.repo_key || r.claims.endpoints.some((e) => !e.restricted) || r.claims.package_ids.length));
  const unresolved = records.filter((r) => SUBMISSION_INTENTS.has(r.intent) && !subs.includes(r));
  const mergeLog = new Map(); // record_id -> [{rule, detail}]
  const log = (id, rule, detail) => { if (!mergeLog.has(id)) mergeLog.set(id, []); mergeLog.get(id).push({ rule, detail }); };
  const ambiguity = new Map(); // key -> [{code, detail}]
  const flag = (key, code, detail) => { if (!ambiguity.has(key)) ambiguity.set(key, []); if (!ambiguity.get(key).some((f) => f.code === code && f.detail === detail)) ambiguity.get(key).push({ code, detail }); };

  const canonRepo = (key) => {
    // apply GitHub-resolved rename: key may be "github.com/o/r[/sub]"
    const base = repoKeyOnly(key);
    const to = renames.get(base);
    if (!to) return { key, renamed: false };
    const sub = key.split("/").slice(3).join("/");
    return { key: sub ? `${to}/${sub}` : to, renamed: true, from: base, to };
  };

  // Primary identity per record
  const primary = new Map();
  for (const r of subs) {
    const c = r.claims;
    if (c.repo_key) {
      const cr = canonRepo(c.repo_key);
      primary.set(r.record_id, { type: "repo", key: cr.key });
      if (cr.renamed) log(r.record_id, "R6", `GitHub resolves ${cr.from} -> ${cr.to}`);
    }
  }
  // Index: package / endpoint -> repo keys (from repo-keyed records)
  const pkgToRepos = new Map(), epToRepos = new Map();
  const add = (m, k, v) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
  for (const r of subs) {
    const p = primary.get(r.record_id);
    if (p?.type !== "repo") continue;
    for (const id of r.claims.package_ids) add(pkgToRepos, id, p.key);
    for (const e of r.claims.endpoints) if (!e.restricted && e.key) add(epToRepos, e.key, p.key);
  }
  for (const [id, s] of pkgToRepos) if (s.size > 1) for (const k of s) flag(k, "shared_package_across_repos", `${id} also claimed by ${[...s].filter((x) => x !== k).join(", ")}`);
  for (const [id, s] of epToRepos) if (s.size > 1) for (const k of s) flag(k, "shared_endpoint_across_repos", `${id} also claimed by ${[...s].filter((x) => x !== k).join(", ")}`);

  for (const r of subs) {
    if (primary.has(r.record_id)) continue;
    const c = r.claims;
    const pkgHit = c.package_ids.map((id) => pkgToRepos.get(id)).find((s) => s && s.size === 1);
    if (pkgHit) { const k = [...pkgHit][0]; primary.set(r.record_id, { type: "repo", key: k }); log(r.record_id, "R2", `shares package with ${k}`); continue; }
    const epHit = c.endpoints.filter((e) => !e.restricted).map((e) => epToRepos.get(e.key)).find((s) => s && s.size === 1);
    if (epHit) { const k = [...epHit][0]; primary.set(r.record_id, { type: "repo", key: k }); log(r.record_id, "R3", `shares endpoint with ${k}`); continue; }
    const ep = c.endpoints.find((e) => !e.restricted && e.key);
    if (ep) { primary.set(r.record_id, { type: "endpoint", key: ep.key }); continue; }
    if (c.package_ids[0]) { primary.set(r.record_id, { type: "package", key: c.package_ids[0] }); continue; }
  }

  // Union records that share a primary key; endpoint/package-only projects merge via R4/R5
  const uf = new UnionFind();
  for (const r of subs) {
    const p = primary.get(r.record_id);
    if (!p) continue;
    uf.union(`k:${p.key}`, r.record_id);
  }
  // Endpoint-only projects that share a package id with other endpoint-only/package-only records
  const pkgOwners = new Map();
  for (const r of subs) {
    const p = primary.get(r.record_id);
    if (!p || p.type === "repo") continue;
    for (const id of r.claims.package_ids) { if (pkgOwners.has(id)) { uf.union(`k:${pkgOwners.get(id)}`, `k:${p.key}`); log(r.record_id, "R5", `shares package ${id}`); } else pkgOwners.set(id, p.key); }
  }

  const groups = new Map();
  for (const r of subs) {
    const p = primary.get(r.record_id);
    if (!p) continue;
    const root = uf.find(r.record_id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  }

  const projects = [];
  for (const recs of groups.values()) {
    recs.sort((a, b) => (a.source.created_at < b.source.created_at ? -1 : 1));
    const keys = [...new Set(recs.map((r) => primary.get(r.record_id).key))];
    const repoKeys = keys.filter((k) => primary.get(recs.find((r) => primary.get(r.record_id).key === k).record_id).type === "repo");
    const canonical = repoKeys[0] || keys[0];
    const identityType = repoKeys.length ? "github_repo" : primary.get(recs[0].record_id).type;
    const mergeReasons = [];
    const keyCounts = {};
    for (const r of recs) {
      const reasons = mergeLog.get(r.record_id) || [];
      reasons.forEach((x) => mergeReasons.push({ record_id: r.record_id, ...x }));
    }
    if (recs.length > 1) mergeReasons.push({ rule: identityType === "github_repo" ? "R1" : "R4", detail: `${recs.length} source records share ${canonical}` });
    for (const r of recs) keyCounts[primary.get(r.record_id).key] = (keyCounts[primary.get(r.record_id).key] || 0) + 1;
    const amb = [...(ambiguity.get(canonical) || [])];
    if (repoKeys.length > 1) amb.push({ code: "multiple_keys_merged", detail: keys.join(", ") });
    // same repo, unrelated names -> likely monorepo / collision
    const names = [...new Set(recs.map((r) => r.claims.name).filter(Boolean))];
    if (identityType === "github_repo" && names.length > 1) {
      const anchor = names[0];
      if (!canonical.split("/").slice(3).length && names.some((n) => !namesCompatible(anchor, n) && !namesCompatible(canonical.split("/")[2], n))) {
        amb.push({ code: "same_repo_incompatible_names", detail: names.slice(0, 5).join(" | ") });
      }
    }
    // repo-level vs subpath overlap
    if (identityType === "github_repo") {
      const base = repoKeyOnly(canonical);
      if (canonical !== base) amb.push({ code: "monorepo_subpath_project", detail: `subpath of ${base}` });
    }

    const pick = (get) => { for (let i = recs.length - 1; i >= 0; i--) { const v = get(recs[i]); if (v) return v; } return null; };
    const variants = (get) => { const m = new Map(); for (const r of recs) { const v = get(r); if (v) { if (!m.has(v)) m.set(v, []); m.get(v).push(r.record_id); } } return [...m].map(([value, record_ids]) => ({ value, record_ids })); };
    const merged = {
      name: pick((r) => r.claims.name),
      description: pick((r) => r.claims.description),
      repo_url: pick((r) => r.claims.repo_url),
      homepage: pick((r) => r.claims.homepage),
      endpoints: [...new Set(recs.flatMap((r) => r.claims.endpoints.filter((e) => !e.restricted).map((e) => e.url)))],
      restricted_endpoints_claimed: [...new Set(recs.flatMap((r) => r.claims.endpoints.filter((e) => e.restricted).map((e) => e.url)))],
      package_ids: [...new Set(recs.flatMap((r) => r.claims.package_ids))].sort(),
      install_command: pick((r) => r.claims.install_command),
      transports: [...new Set(recs.flatMap((r) => r.claims.transports))],
      hosting: pick((r) => r.claims.hosting),
      license: pick((r) => r.claims.license),
      auth: pick((r) => r.claims.auth),
      category: pick((r) => r.claims.category),
      registry_names: [...new Set(recs.map((r) => r.claims.registry_name).filter(Boolean))],
      tools: [...new Set(recs.flatMap((r) => r.claims.tools))].slice(0, 80),
    };
    const conflicts = {};
    for (const [f, get] of [["name", (r) => r.claims.name], ["license", (r) => r.claims.license], ["repo_url", (r) => r.claims.repo_url]]) {
      const v = variants(get);
      if (v.length > 1) conflicts[f] = v;
    }
    const authors = [...new Set(recs.map((r) => r.source.author_login).filter(Boolean))];
    const ownerLogin = canonical.startsWith("github.com/") ? canonical.split("/")[1] : null;
    projects.push({
      project_id: pid(canonical),
      canonical_key: canonical,
      identity_type: identityType,
      source_record_ids: recs.map((r) => r.record_id),
      source_count: recs.length,
      source_issue_numbers: [...new Set(recs.filter((r) => r.source.type === "issue").map((r) => r.source.number))],
      authors,
      submitted_by_repo_owner: ownerLogin ? authors.some((a) => a.toLowerCase() === ownerLogin) : null,
      first_seen: recs[0].source.created_at,
      last_seen: recs[recs.length - 1].source.created_at,
      upstream_states: [...new Set(recs.map((r) => `${r.source.type}:${r.source.state ?? "n/a"}${r.source.state_reason ? "/" + r.source.state_reason : ""}`))],
      merged_claims: merged,
      claim_conflicts: conflicts,
      merge_reasons: mergeReasons,
      ambiguity_flags: amb,
      security_flags: dedupFlags(recs.flatMap((r) => r.security_flags.map((f) => ({ ...f, record_id: r.record_id })))),
      quality_flags: [...new Set(recs.flatMap((r) => r.quality_flags))],
      _key_counts: keyCounts,
    });
  }
  projects.sort((a, b) => (a.first_seen < b.first_seen ? -1 : 1));
  return { projects, unresolved, subs };
}

function dedupFlags(flags) {
  const seen = new Set(); const out = [];
  for (const f of flags) { const k = `${f.code}|${f.detail}`; if (!seen.has(k)) { seen.add(k); out.push(f); } }
  return out;
}

const BLOCKING_EXCLUDED = "monorepo_subpath_project";

/**
 * Counting definitions (every figure states its unit):
 *  - duplicate_records: RECORDS that are not the first record of their project (= placed records - projects).
 *  - multi_record_projects: PROJECTS with >1 record. The R1 (GitHub identity) / R4 (endpoint or package identity) merge_reasons
 *    entries are one per such project, NOT one per merged record.
 *  - R2/R3/R5/R6 merge_reasons entries are one per RECORD that was linked or re-keyed by that rule.
 *  - rename_mappings_applied: REPOSITORIES (old key -> new key) found by the enrichment; records_rekeyed_by_rename: RECORDS re-keyed;
 *    projects_joined_by_rename: PROJECTS whose records carried more than one original repo key because a rename made them equal.
 *  - ambiguous_projects: distinct PROJECTS with a review-relevant ambiguity flag (monorepo_subpath_project excluded).
 */
export function dedupStats(projects, recordsById, renameCount) {
  const entries = {}, perRecord = {}, basisCount = {}, flagProjects = {};
  let multi = 0, recordsInMulti = 0, rekeyedRecords = new Set(), projWithRenamed = 0, joinedByRename = 0, ambiguous = 0, ambiguousMulti = 0;
  const multiByIdentity = {};
  for (const p of projects) {
    for (const m of p.merge_reasons) {
      entries[m.rule] = (entries[m.rule] || 0) + 1;
      if (m.record_id) (perRecord[m.rule] ||= new Set()).add(m.record_id);
    }
    const renamed = p.merge_reasons.some((m) => m.rule === "R6");
    if (renamed) projWithRenamed++;
    for (const m of p.merge_reasons) if (m.rule === "R6") rekeyedRecords.add(m.record_id);
    if (p.source_count > 1) {
      multi++; recordsInMulti += p.source_count;
      multiByIdentity[p.identity_type] = (multiByIdentity[p.identity_type] || 0) + 1;
      for (const rid of p.source_record_ids.slice(1)) {
        const rules = [...new Set(p.merge_reasons.filter((m) => m.record_id === rid).map((m) => m.rule))].sort();
        const k = rules.length ? `linked_by_${rules.join("+")}` : "same_key_as_group";
        basisCount[k] = (basisCount[k] || 0) + 1;
      }
      if (renamed) {
        const keys = new Set(p.source_record_ids.map((i) => recordsById.get(i)?.claims?.repo_key).filter(Boolean));
        if (keys.size > 1) joinedByRename++;
      }
    }
    const codes = new Set(p.ambiguity_flags.map((f) => f.code));
    codes.delete(BLOCKING_EXCLUDED);
    if (codes.size) ambiguous++;
    if (codes.size > 1) ambiguousMulti++;
    for (const c of codes) flagProjects[c] = (flagProjects[c] || 0) + 1;
  }
  return {
    duplicate_records: projects.reduce((n, p) => n + p.source_count - 1, 0),
    multi_record_projects: multi,
    records_in_multi_record_projects: recordsInMulti,
    multi_record_projects_by_identity: multiByIdentity,
    duplicate_records_by_basis: basisCount,
    merge_annotation_entries_by_rule: entries,
    merge_annotation_distinct_records_by_rule: Object.fromEntries(Object.entries(perRecord).map(([k, v]) => [k, v.size])),
    rename_mappings_applied: renameCount,
    records_rekeyed_by_rename: rekeyedRecords.size,
    projects_containing_renamed_records: projWithRenamed,
    projects_joined_by_rename: joinedByRename,
    ambiguous_projects: ambiguous,
    ambiguous_projects_with_multiple_flags: ambiguousMulti,
    ambiguous_projects_by_flag: flagProjects,
  };
}

export function main(argv = process.argv.slice(2)) {
  const { values: a } = parseArgs({ args: argv, options: { out: { type: "string", default: "data/upstream-import" }, enrichment: { type: "string" } } });
  const out = path.resolve(a.out);
  const records = readJsonl(path.join(out, "normalized", "normalized.jsonl"));
  const renames = new Map();
  if (a.enrichment && fs.existsSync(a.enrichment)) {
    for (const e of readJsonl(a.enrichment)) {
      if (e.resolved && e.requested_key && e.canonical_key) {
        // requested_key may carry a subpath; renames are repository-level
        const from = repoKeyOnly(e.requested_key), to = repoKeyOnly(e.canonical_key);
        if (from !== to) renames.set(from, to);
      }
    }
  }
  const { projects, unresolved } = buildProjects(records, { renames });
  ensureDir(path.join(out, "dedup"));
  const tag = a.enrichment ? "projects.jsonl" : "projects.pre-enrichment.jsonl";
  writeJsonlAtomic(path.join(out, "dedup", tag), projects);
  writeJsonlPublicPrivate(path.join(out, "dedup", "unresolved-submissions.jsonl"), unresolved.map((r) => ({ record_id: r.record_id, url: r.source.url, author: r.source.author_login, name: r.claims.name, intent: r.intent })), ["author", "name"]);
  const bySize = {};
  for (const p of projects) bySize[p.source_count] = (bySize[p.source_count] || 0) + 1;
  const summary = {
    generated_at: new Date().toISOString(), enrichment_applied: !!a.enrichment,
    submission_records_with_identity: projects.reduce((n, p) => n + p.source_count, 0),
    submission_records_without_identity: unresolved.length,
    projects: projects.length,
    projects_with_multiple_sources: projects.filter((p) => p.source_count > 1).length,
    projects_by_source_count: bySize,
    ...dedupStats(projects, new Map(records.map((r) => [r.record_id, r])), renames.size),
    by_identity_type: projects.reduce((m, p) => ((m[p.identity_type] = (m[p.identity_type] || 0) + 1), m), {}),
  };
  writeJsonAtomic(path.join(out, "dedup", a.enrichment ? "dedup-summary.json" : "dedup-summary.pre-enrichment.json"), summary);
  console.error(JSON.stringify(summary));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
