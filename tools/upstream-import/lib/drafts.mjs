// Listing drafts from candidate facts (checklist C5). Pure functions, no database access.
//
// Rules from reports/publication-gate-checklist.md and import-eligibility-policy.md:
//  - display name comes from the repository or the identifier, never from the submitter's title;
//  - summary text is ORIGINAL and facts-only: it is built from a template out of tier 1/2 facts, never copied from a README, an issue
//    or a description, and it contains none of the forbidden words (verified, safe, secure, trusted, recommended) and no ratings;
//  - the "last checked" date is the real retrieval date of the facts (repository: when the pipeline read it; declared-only entries:
//    the date of the latest public declaration). A draft without a trustworthy date is not built, so gate P5 keeps it unpublished;
//  - a draft is a proposal: a person must approve the summary (gate P6) before it can pass the publication gates.

export const TEMPLATE_VERSION = "t1";
export const FORBIDDEN = /\b(verified|safe|secure|trusted|recommended)\b/i;

const dateOnly = (iso) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const isoOrNull = (iso) => (dateOnly(iso) ? new Date(iso).toISOString() : null);

/** Human-readable identifier for a candidate: repository name, endpoint host and path, or package id. */
export function displayName(candidate) {
  const f = candidate.facts ?? {};
  if (f.repo?.name_with_owner) return f.repo.name_with_owner;
  const key = candidate.canonical_key ?? "";
  if (key.startsWith("endpoint:")) return key.slice("endpoint:".length);
  const i = key.indexOf(":");
  if (i > 0 && !key.startsWith("github.com/")) return key.slice(i + 1);
  return key.replace(/^github\.com\//, "");
}

/** URL-safe slug from an identifier: lower case, [a-z0-9-], at most 80 characters. */
export function slugFor(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  return s || "entry";
}

/** Same slug with a short suffix, used when the plain slug is already taken. */
export function slugWithSuffix(name, suffix) {
  return `${slugFor(name).slice(0, 72).replace(/-+$/g, "")}-${slugFor(suffix).slice(0, 7)}`;
}

function summaryFor(candidate, level) {
  const f = candidate.facts ?? {};
  const name = displayName(candidate);
  const parts = [];
  if (candidate.identity_type === "github_repo") {
    parts.push(`${name} is a public GitHub repository that has been listed as a Model Context Protocol server.`);
    if (f.repo?.archived) parts.push("The repository is archived.");
    if (f.repo?.fork) parts.push("The repository is a fork.");
    const pushed = dateOnly(f.repo?.pushed_at);
    if (pushed) parts.push(`It was last updated on ${pushed}.`);
    parts.push(f.repo?.license ? `Its licence metadata reads ${f.repo.license}.` : "No licence was found in its repository metadata.");
  } else if (candidate.identity_type === "endpoint") {
    parts.push(`${name} is a remote endpoint that its publisher has declared to be a Model Context Protocol server.`);
  } else {
    parts.push(`${name} is a package that its publisher has declared to be a Model Context Protocol server.`);
  }
  if (level === 0) parts.push("Nothing about it has been checked by this directory.");
  return parts.join(" ");
}

/**
 * Build the draft fields for one candidate, or `{ skipped: reason }` when a trustworthy draft cannot be built.
 * `candidate` = { canonical_key, identity_type, facts }, `evidenceLevel` from the evaluation (0, 1 or 2).
 */
export function buildDraft(candidate, evidenceLevel) {
  const f = candidate.facts ?? {};
  const level = [0, 1, 2].includes(evidenceLevel) ? evidenceLevel : 0;
  const checked = level === 0 ? isoOrNull(f.declared_at) : isoOrNull(f.repo?.checked_at);
  if (!checked) return { skipped: level === 0 ? "no declaration date" : "no repository retrieval date" };
  const name = displayName(candidate);
  const sourceUrl = f.repo_url ?? (candidate.identity_type === "endpoint" ? f.endpoints?.[0] : null) ?? null;
  const source_links = sourceUrl && /^https?:\/\//i.test(sourceUrl)
    ? [{ url: sourceUrl, kind: candidate.identity_type === "github_repo" ? "repo" : "declared", retrieved_at: checked }]
    : [];
  if (!source_links.length) return { skipped: "no public source link" };
  const summary = summaryFor(candidate, level);
  // The forbidden words concern what THIS directory says. A project's own identifier may contain one ("secure-notes-mcp"), so the
  // check runs on the template wording with the identifier removed.
  if (FORBIDDEN.test(summary.split(name).join(""))) throw new Error(`template produced forbidden wording for ${candidate.canonical_key}`);
  return {
    title: name,
    summary,
    summary_kind: "template",
    content_type: level === 2 ? "server" : "unknown",
    install_text: f.install_command || f.package_ids?.[0] || f.endpoints?.[0] || "not documented",
    licence: f.repo?.license || f.license_claimed || "unknown",
    last_checked_at: checked,
    evidence_level: level,
    facts: f,
    source_links,
    rights_flags: {},
    template_version: TEMPLATE_VERSION,
  };
}
