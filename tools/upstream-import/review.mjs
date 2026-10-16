// Interim review workflow (checklist C2/C3), used until the review UI exists.
//
//   queue:   prioritised work list from the database in the C3 order, exported as CSV with blank decision columns
//   apply:   reads a filled CSV and applies each decision through the audited SQL functions as the named reviewer
//
// Everything goes through review_candidate / clear_* / suppress_candidate, so the same gates, guards, reasons and audit trail apply as
// for any future UI. It is a library over a `db.query` handle (a CLI needs the connection setup that comes with the hosting decision, D2).
// This tool has no bulk path and cannot publish: `publish` is not an accepted action (C6: nothing is published
// until the Phase D launch gates pass).
import { writeCsv } from "./lib/store.mjs";

export const ACTIONS = ["approve", "reject", "reopen", "mark_unavailable", "unpublish", "clear_security_flag", "clear_removal_hold", "suppress", "resolve_duplicate_group"];
export const QUEUE_COLUMNS = ["priority", "queue", "canonical_key", "status", "category", "lane", "evidence_level", "ambiguity_flags", "security_flags", "removal_hold", "rules"];
export const SHEET_COLUMNS = [...QUEUE_COLUMNS, "decision", "reason"];

const QUEUE_NAMES = { 1: "ambiguous group", 2: "security flag", 3: "removal hold", 4: "needs review", 5: "individual lane", 6: "family sample", 7: "bulk lane", 8: "other" };

const QUEUE_SQL = `
  select case when jsonb_array_length(coalesce(ev.evidence->'ambiguity_flags', '[]'::jsonb)) > 0 then 1
              when cardinality(c.security_flags) > 0 then 2
              when c.removal_hold then 3
              when c.status = 'needs_review' then 4
              when ev.evidence->>'lane' = 'individual' then 5
              when ev.evidence->>'lane' = 'family_sample' then 6
              when ev.evidence->>'lane' = 'bulk' then 7 else 8 end as priority,
         c.canonical_key, c.status::text as status, ev.category, ev.evidence->>'lane' as lane, ev.evidence->>'evidence_level' as evidence_level,
         (select string_agg(x, ';') from jsonb_array_elements_text(coalesce(ev.evidence->'ambiguity_flags', '[]'::jsonb)) x) as ambiguity_flags,
         array_to_string(c.security_flags, ';') as security_flags, c.removal_hold,
         (select string_agg(r->>'rule', ';') from jsonb_array_elements(ev.reasons) r) as rules
  from candidate c join eligibility_evaluation ev on ev.candidate_id = c.id and ev.is_current
  where c.status in ('candidate', 'eligible', 'needs_review', 'ineligible')
  order by 1, 2
  limit $1 offset $2`;

export async function reviewQueue(db, { limit = 200, offset = 0 } = {}) {
  const rows = (await db.query(QUEUE_SQL, [limit, offset])).rows;
  return rows.map((r) => ({ ...r, priority: Number(r.priority), queue: QUEUE_NAMES[Number(r.priority)], removal_hold: !!r.removal_hold }));
}

export function writeSheet(file, rows) {
  writeCsv(file, SHEET_COLUMNS, rows.map((r) => ({ ...r, decision: "", reason: "" })));
}

/** Validate sheet rows before touching the database. Returns { rows, errors }. */
export function validateDecisions(sheet) {
  const rows = [], errors = [];
  for (const [i, r] of sheet.entries()) {
    const decision = (r.decision ?? "").trim().toLowerCase();
    if (!decision) continue; // undecided rows are skipped, not an error
    const where = `row ${i + 2} (${r.canonical_key})`;
    if (!ACTIONS.includes(decision)) { errors.push(`${where}: action "${decision}" is not allowed (allowed: ${ACTIONS.join(", ")})`); continue; }
    if (!(r.reason ?? "").trim()) { errors.push(`${where}: a reason is required`); continue; }
    if (!(r.canonical_key ?? "").trim()) { errors.push(`${where}: canonical_key is required`); continue; }
    rows.push({ canonical_key: r.canonical_key.trim(), action: decision, reason: r.reason.trim() });
  }
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.canonical_key}|${r.action}`;
    if (seen.has(k)) errors.push(`${r.canonical_key}: duplicate ${r.action} decision in the sheet`);
    seen.add(k);
  }
  return { rows, errors };
}

const SQL_CALL = {
  suppress: "select suppress_candidate($1::uuid, $2)",
  resolve_duplicate_group: "select resolve_duplicate_group(g.group_id, $2) from duplicate_group_member g join duplicate_group d on d.id = g.group_id where g.candidate_id = $1::uuid and d.needs_manual_review",
  clear_security_flag: "select clear_security_flag($1::uuid, $2)",
  clear_removal_hold: "select clear_removal_hold($1::uuid, $2)",
};

/**
 * Apply validated decisions one by one, each in its own savepoint, as `reviewerId` (an auth.users id with a reviewer role).
 * `dryRun` runs everything and rolls it back, so the reviewer sees exactly which decisions the gates would refuse.
 */
export async function applyDecisions(db, decisions, { reviewerId, dryRun = false } = {}) {
  if (!reviewerId) throw new Error("reviewerId is required");
  const results = [];
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [reviewerId]);
    for (const [i, d] of decisions.entries()) {
      const sp = `d${i}`;
      await db.query(`savepoint ${sp}`);
      try {
        const cand = (await db.query("select id from candidate where canonical_key = $1", [d.canonical_key])).rows[0];
        if (!cand) throw new Error("unknown candidate");
        if (SQL_CALL[d.action]) {
          const r = await db.query(SQL_CALL[d.action], [cand.id, d.reason]);
          if (d.action === "resolve_duplicate_group" && r.rows.length === 0) throw new Error("no unresolved duplicate group for this candidate");
        }
        else await db.query("select review_candidate($1::uuid, $2::review_action, $3)", [cand.id, d.action, d.reason]);
        await db.query(`release savepoint ${sp}`);
        results.push({ ...d, ok: true, error: null });
      } catch (e) {
        await db.query(`rollback to savepoint ${sp}`);
        results.push({ ...d, ok: false, error: String(e.message || e).split("\n")[0] });
      }
    }
    await db.query(dryRun ? "rollback" : "commit");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  }
  return results;
}

/** Run one reviewer-only SQL function as `reviewerId` in its own transaction; returns the first row. */
async function asReviewer(db, reviewerId, sql, params) {
  if (!reviewerId) throw new Error("reviewerId is required");
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [reviewerId]);
    const r = await db.query(sql, params);
    await db.query("commit");
    return r.rows[0];
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  }
}

// Takedown workflow (migration 0004). A request arrives through the published contact address and is recorded by a reviewer.
export const recordTakedown = async (db, reviewerId, { kind, ref, contact = null, details = null }) =>
  (await asReviewer(db, reviewerId, "select record_takedown_request($1, $2, $3, $4) as id", [kind, ref, contact, details])).id;
export const verifyTakedownOwnership = (db, reviewerId, id, basis) => asReviewer(db, reviewerId, "select verify_takedown_ownership($1::uuid, $2)", [id, basis]);
export const resolveTakedown = (db, reviewerId, id, decision, reason) => asReviewer(db, reviewerId, "select resolve_takedown_request($1::uuid, $2, $3)", [id, decision, reason]);
