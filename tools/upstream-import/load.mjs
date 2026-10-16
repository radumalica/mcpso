// Stage 8 — load the pipeline output into the database (migrations 0001-0002).
//
//   raw/*.jsonl                       -> source_record (+ source_record_revision when a record's content changed)
//   classified/projects-classified    -> candidate (via import_upsert_candidate), eligibility_evaluation
//   dedup/projects, normalized        -> source_candidate_map: EXACTLY ONE disposition row for EVERY source record
//
// The loader never approves or publishes: it only sets the machine statuses candidate / needs_review / eligible / ineligible
// and only on candidates that are still in one of those statuses. It is idempotent: a second run over the same files inserts
// no source_record, candidate, evaluation or map rows (only a new import_batch row and last_batch_id stamps).
//
// `db` is any object with `query(sql, params) => Promise<{ rows }>` (PGlite, node-postgres Client/PoolClient).
// Run it with a role that may call import_upsert_candidate (the service role), never from a browser.

import crypto from "node:crypto";
import path from "node:path";
import { readJsonl } from "./lib/store.mjs";

export const LOADER_VERSION = "load-v1";
const KIND = { issue: "issue", pull_request: "pull_request", issue_comment: "issue_comment" };
const PREFIX = { issue: "issue", pull_request: "pr", issue_comment: "comment" };
const VOLATILE = new Set(["collected_at", "batch_id"]); // change on every collection; not part of the content hash
const MACHINE_STATUSES = ["candidate", "needs_review", "eligible", "ineligible"];
const CHUNK = 500;

export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function contentHash(record) {
  const stable = Object.fromEntries(Object.entries(record).filter(([k]) => !VOLATILE.has(k)));
  return crypto.createHash("sha256").update(canonicalJson(stable)).digest("hex");
}

const chunks = (arr, n = CHUNK) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));
const recordId = (kind, sourceId) => `${PREFIX[kind]}:${sourceId}`;

/** Tier 1/2 facts only: no submitter handles, no free-text descriptions. */
export function candidateFacts(p) {
  const repo = p.repo ?? null;
  return {
    repo_url: p.repo_url ?? null,
    homepage: p.homepage ?? null,
    endpoints: p.endpoints ?? [],
    package_ids: p.package_ids ?? [],
    install_command: p.install_command ?? null,
    hosting: p.hosting ?? null,
    transports: p.transports ?? [],
    license_claimed: p.license_claimed ?? null,
    repo: repo && { name_with_owner: repo.name_with_owner ?? null, archived: !!repo.archived, fork: !!repo.fork },
    official_registry_matches: p.official_registry_matches ?? [],
  };
}

/** Disposition of one normalised record. `placed` is the dedup project the record belongs to, if any. */
export function dispositionOf(rec, placed, targetKey) {
  const base = { intent: rec.intent, rationale: rec.intent_reason ?? null };
  switch (rec.intent) {
    case "submission":
    case "submission_unclear":
      return placed
        ? { ...base, disposition: "mapped", candidate_key: placed.canonical_key, method: `dedup:${(placed.merge_reasons ?? []).join("+") || "same-key"}`, confidence: (placed.merge_reasons ?? []).length ? "high" : "exact" }
        : { ...base, disposition: "no_identity", candidate_key: null, method: "dedup:unresolved", confidence: "low" };
    case "no_identity": return { ...base, disposition: "no_identity", candidate_key: null, method: "normalize:no_identity", confidence: "exact" };
    case "code_contribution": return { ...base, disposition: "code_contribution", candidate_key: null, method: "normalize:code_contribution", confidence: "exact" };
    case "question_or_feedback": return { ...base, disposition: "not_submission", candidate_key: null, method: "normalize:question_or_feedback", confidence: "exact" };
    case "removal_request": return { ...base, disposition: "removal_request", candidate_key: targetKey ?? null, method: "normalize:removal_request", confidence: targetKey ? "medium" : "low" };
    case "link_correction": return { ...base, disposition: "link_correction", candidate_key: targetKey ?? null, method: "normalize:link_correction", confidence: targetKey ? "medium" : "low" };
    default: throw new Error(`unknown intent ${rec.intent}`);
  }
}

export function readDataset(dir) {
  const rd = (...p) => readJsonl(path.join(dir, ...p));
  const raw = [
    ...rd("raw", "issues.jsonl").map((r) => ({ ...r, kind: KIND.issue })),
    ...rd("raw", "pull_requests.jsonl").map((r) => ({ ...r, kind: KIND.pull_request })),
    ...rd("raw", "issue_comments.jsonl").map((r) => ({ ...r, kind: KIND.issue_comment })),
  ];
  return {
    raw,
    projects: rd("dedup", "projects.jsonl"),
    classified: rd("classified", "projects-classified.jsonl"),
    normalized: rd("normalized", "normalized.jsonl"),
    removals: rd("classified", "removal-requests.jsonl"),
    linkCorrections: rd("classified", "link-corrections.jsonl"),
  };
}

async function loadRawRecords(db, ds, repo, batchId) {
  const existing = new Map((await db.query("select id, kind::text as kind, source_id::text as sid, content_hash from source_record where source_repo = $1", [repo])).rows
    .map((r) => [`${r.kind}:${r.sid}`, r]));
  const fresh = [], changed = [], same = [];
  for (const r of ds.raw) {
    const row = {
      kind: r.kind, source_id: r.source_id, source_number: r.source_number ?? null, source_url: r.source_url,
      author_login: r.author_login ?? null, source_created_at: r.created_at ?? null, source_updated_at: r.updated_at ?? null,
      source_state: r.state ?? null, raw: r, content_hash: contentHash(r), fetched_at: r.collected_at ?? new Date().toISOString(),
    };
    const old = existing.get(`${r.kind}:${r.source_id}`);
    if (!old) fresh.push(row);
    else if (old.content_hash !== row.content_hash) changed.push({ ...row, id: old.id });
    else same.push(old.id);
  }
  const cols = `kind source_kind, source_id bigint, source_number integer, source_url text, author_login text, source_created_at timestamptz,
    source_updated_at timestamptz, source_state text, raw jsonb, content_hash text, fetched_at timestamptz`;
  for (const part of chunks(fresh)) {
    await db.query(`insert into source_record (source_repo, kind, source_id, source_number, source_url, author_login, source_created_at,
        source_updated_at, source_state, raw, content_hash, first_batch_id, last_batch_id, fetched_at)
      select $2, t.kind, t.source_id, t.source_number, t.source_url, t.author_login, t.source_created_at, t.source_updated_at,
        t.source_state, t.raw, t.content_hash, $3::uuid, $3::uuid, t.fetched_at
      from jsonb_to_recordset($1::jsonb) as t(${cols})`, [JSON.stringify(part), repo, batchId]);
  }
  for (const c of changed) {
    await db.query(`insert into source_record_revision (source_record_id, content_hash, raw, batch_id)
      select id, content_hash, raw, last_batch_id from source_record where id = $1`, [c.id]);
    await db.query(`update source_record set raw = $2::jsonb, content_hash = $3, source_updated_at = $4, source_state = $5,
        author_login = $6, source_url = $7, last_batch_id = $8, fetched_at = $9 where id = $1`,
      [c.id, JSON.stringify(c.raw), c.content_hash, c.source_updated_at, c.source_state, c.author_login, c.source_url, batchId, c.fetched_at]);
  }
  for (const part of chunks(same)) await db.query("update source_record set last_batch_id = $2 where id = any($1::uuid[])", [part, batchId]);
  return { inserted: fresh.length, changed: changed.length, unchanged: same.length };
}

async function loadCandidates(db, ds, batchId) {
  const identity = new Map(ds.projects.map((p) => [p.project_id, p.identity_type]));
  for (const p of ds.classified) {
    if (!identity.has(p.project_id)) throw new Error(`classified project ${p.project_id} has no dedup entry`);
    await db.query("select import_upsert_candidate($1, $2, $3::jsonb, $4::uuid)", [p.canonical_key, identity.get(p.project_id), JSON.stringify(candidateFacts(p)), batchId]);
  }
  const rows = ds.classified.map((p) => ({
    key: p.canonical_key, status: p.category, name: p.name ?? null, security_flags: p.security_flags ?? [],
    removal_hold: (p.quality_indicators ?? []).includes("removal_request_pending"), importable: p.importable !== false,
    category: p.category, reasons: p.reasons ?? [],
    evidence: { strong: p.evidence_strong ?? [], weak: p.evidence_weak ?? [], kinds: p.evidence_kinds ?? [], registry_matches: p.official_registry_matches ?? [], unverified_repo_claims: p.official_registry_unverified_repo_claims ?? [] },
    quality_indicators: p.quality_indicators ?? [], security_concern: !!p.security_concern,
  }));
  for (const part of chunks(rows)) {
    const json = JSON.stringify(part);
    // Status only moves between machine statuses; approved / published / withdrawn / rejected are never touched by a load.
    await db.query(`update candidate c set status = t.status::candidate_status, name = t.name, security_flags = t.security_flags,
        removal_hold = c.removal_hold or t.removal_hold, importable = c.importable and t.importable, updated_at = now()
      from jsonb_to_recordset($1::jsonb) as t(key text, status text, name text, security_flags text[], removal_hold boolean, importable boolean)
      where c.canonical_key = t.key and c.status::text = any($2::text[])
        and (c.status::text, c.name, c.security_flags, c.removal_hold, c.importable) is distinct from (t.status, t.name, t.security_flags, c.removal_hold or t.removal_hold, c.importable and t.importable)`,
      [json, MACHINE_STATUSES]);
    await db.query(`insert into eligibility_evaluation (candidate_id, evaluator_version, category, reasons, evidence, quality_indicators, security_concern)
      select c.id, $2, t.category, t.reasons, t.evidence, t.quality_indicators, t.security_concern
      from jsonb_to_recordset($1::jsonb) as t(key text, category text, reasons jsonb, evidence jsonb, quality_indicators text[], security_concern boolean)
      join candidate c on c.canonical_key = t.key
      on conflict (candidate_id) where is_current do update
        set evaluator_version = excluded.evaluator_version, category = excluded.category, reasons = excluded.reasons, evidence = excluded.evidence,
            quality_indicators = excluded.quality_indicators, security_concern = excluded.security_concern, evaluated_at = now()
        where (eligibility_evaluation.category, eligibility_evaluation.reasons, eligibility_evaluation.evidence, eligibility_evaluation.quality_indicators, eligibility_evaluation.security_concern)
          is distinct from (excluded.category, excluded.reasons, excluded.evidence, excluded.quality_indicators, excluded.security_concern)`,
      [json, LOADER_VERSION]);
  }
  return { candidates: rows.length };
}

async function loadDispositions(db, ds, batchId) {
  const placedBy = new Map();
  for (const p of ds.projects) for (const id of p.source_record_ids) placedBy.set(id, p);
  const norm = new Map(ds.normalized.map((n) => [n.record_id, n]));
  const candKeys = new Set(ds.classified.map((c) => c.canonical_key));
  const target = new Map([...ds.removals, ...ds.linkCorrections].map((r) => {
    const keys = (r.repo_keys ?? []).filter((k) => candKeys.has(k));
    return [r.record_id, keys.length === 1 ? keys[0] : null];
  }));
  const rows = ds.raw.map((r) => {
    const id = recordId(r.kind, r.source_id);
    const n = norm.get(id);
    const d = n
      ? dispositionOf(n, placedBy.get(id), target.get(id))
      : { disposition: "context_comment", candidate_key: null, intent: "context_comment", method: "normalize:outside-submission-thread", confidence: "exact", rationale: null };
    return { kind: r.kind, source_id: r.source_id, ...d };
  });
  for (const part of chunks(rows)) {
    await db.query(`insert into source_candidate_map (source_record_id, disposition, candidate_id, intent, method, confidence, rationale, mapped_batch_id)
      select s.id, t.disposition, c.id, t.intent, t.method, t.confidence, t.rationale, $2::uuid
      from jsonb_to_recordset($1::jsonb) as t(kind source_kind, source_id bigint, disposition text, candidate_key text, intent text, method text, confidence text, rationale text)
      join source_record s on s.kind = t.kind and s.source_id = t.source_id
      left join candidate c on c.canonical_key = t.candidate_key
      on conflict (source_record_id) do update
        set disposition = excluded.disposition, candidate_id = excluded.candidate_id, intent = excluded.intent, method = excluded.method,
            confidence = excluded.confidence, rationale = excluded.rationale, mapped_batch_id = excluded.mapped_batch_id, mapped_at = now()
        where (source_candidate_map.disposition, source_candidate_map.candidate_id, source_candidate_map.intent, source_candidate_map.method, source_candidate_map.confidence)
          is distinct from (excluded.disposition, excluded.candidate_id, excluded.intent, excluded.method, excluded.confidence)`, [JSON.stringify(part), batchId]);
  }
  // Fail closed: a candidate that a removal request resolves to is held no matter what the classifier output says (the hold
  // is only ever raised here, never cleared; clearing is an individual reviewer action, clear_removal_hold).
  const held = await db.query(`update candidate set removal_hold = true, updated_at = now()
    where not removal_hold and id in (select candidate_id from source_candidate_map where disposition = 'removal_request' and candidate_id is not null)`);
  return { dispositions: rows.length, removal_holds_added: held.affectedRows ?? held.rowCount ?? 0 };
}

export async function loadDataset({ db, dataDir, sourceRepo = "chatmcp/mcpso", note = null }) {
  const ds = readDataset(dataDir);
  const batch = (await db.query("insert into import_batch (source_repo, mode, tool_version, note) values ($1, 'full', $2, $3) returning id", [sourceRepo, LOADER_VERSION, note])).rows[0].id;
  try {
    await db.query("begin");
    const raw = await loadRawRecords(db, ds, sourceRepo, batch);
    const cand = await loadCandidates(db, ds, batch);
    const map = await loadDispositions(db, ds, batch);
    const counts = { ...raw, ...cand, ...map };
    await db.query("update import_batch set status = 'completed', finished_at = now(), counts = $2::jsonb where id = $1", [batch, JSON.stringify(counts)]);
    await db.query("commit");
    return { batch, counts, dataset: ds };
  } catch (e) {
    await db.query("rollback").catch(() => {});
    await db.query("update import_batch set status = 'failed', finished_at = now(), note = $2 where id = $1", [batch, String(e.message).slice(0, 300)]).catch(() => {});
    throw e;
  }
}

/** Reconcile database counts against the files they were loaded from. Returns { ok, checks }. */
export async function reconcileDatabase(db, ds) {
  const n = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
  const count = (arr, f) => arr.filter(f).length;
  const checks = [];
  const check = (name, expected, actual) => checks.push({ name, expected, actual, ok: expected === actual });

  check("source_record rows = raw records", ds.raw.length, await n("select count(*) n from source_record"));
  for (const k of Object.values(KIND)) check(`source_record ${k}`, count(ds.raw, (r) => r.kind === k), await n("select count(*) n from source_record where kind = $1", [k]));
  check("distinct (kind, source_id) in files", ds.raw.length, new Set(ds.raw.map((r) => `${r.kind}:${r.source_id}`)).size);
  check("map rows = source_record rows", await n("select count(*) n from source_record"), await n("select count(*) n from source_candidate_map"));
  check("source records without a disposition", 0, await n("select count(*) n from source_record s left join source_candidate_map m on m.source_record_id = s.id where m.source_record_id is null"));
  const placed = ds.projects.reduce((s, p) => s + p.source_record_ids.length, 0);
  check("mapped dispositions = placed records", placed, await n("select count(*) n from source_candidate_map where disposition = 'mapped'"));
  check("mapped rows without a candidate", 0, await n("select count(*) n from source_candidate_map where disposition = 'mapped' and candidate_id is null"));
  check("candidates = projects", ds.projects.length, await n("select count(*) n from candidate"));
  check("candidates without a mapped record", 0, await n("select count(*) n from candidate c where not exists (select 1 from source_candidate_map m where m.candidate_id = c.id and m.disposition = 'mapped')"));
  for (const cat of ["eligible", "needs_review", "ineligible"]) {
    check(`candidates ${cat}`, count(ds.classified, (c) => c.category === cat), await n("select count(*) n from candidate where status::text = $1", [cat]));
    check(`current evaluations ${cat}`, count(ds.classified, (c) => c.category === cat), await n("select count(*) n from eligibility_evaluation where is_current and category = $1", [cat]));
  }
  check("approved or published", 0, await n("select count(*) n from candidate where status in ('approved','published')"));
  check("listings", 0, await n("select count(*) n from listing"));
  check("security-flagged candidates", count(ds.classified, (c) => (c.security_flags ?? []).length > 0), await n("select count(*) n from candidate where cardinality(security_flags) > 0"));
  // The database may hold MORE than the classifier (fail-closed additions from removal dispositions), never fewer.
  const fileHeld = ds.classified.filter((c) => (c.quality_indicators ?? []).includes("removal_request_pending")).map((c) => c.canonical_key);
  check("classifier-held candidates without a database hold", 0, await n("select count(*) n from candidate where canonical_key = any($1::text[]) and not removal_hold", [fileHeld]));
  // Independent of the classifier field above: derived from the stored dispositions only.
  check("candidates targeted by a removal request without a hold", 0, await n(`select count(*) n from candidate c where not c.removal_hold
    and exists (select 1 from source_candidate_map m where m.candidate_id = c.id and m.disposition = 'removal_request')`));
  check("candidate facts without handles", 0, await n("select count(*) n from candidate where facts ? 'authors' or facts ? 'author_login'"));
  return { ok: checks.every((c) => c.ok), checks };
}
