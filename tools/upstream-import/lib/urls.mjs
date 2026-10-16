// URL extraction and canonical project identity.
//
// Identity key rules (documented in reports/submission-import-methodology.md):
//   github.com/<owner>/<repo>[/<subpath>]    all lower-case
// - owner/repo are case-insensitive on GitHub, so they are lower-cased.
// - ".git" suffix, trailing "/", "www.", query and fragment are dropped.
// - /tree/<branch>/<path> and /blob/<branch>/<path> keep <path> as a *subpath*
//   (monorepo servers such as modelcontextprotocol/servers/src/git are distinct
//   projects). The branch is assumed to be a single path segment; branch names
//   containing "/" are a known limitation and resolve to a wrong subpath.
//   A blob URL to a file keeps only the directory part.
// - Non-repo pages (/issues, /pull/N, /releases, /wiki, ...) map to the repo.
// - raw.githubusercontent.com/<o>/<r>/<branch>/<path> maps like a blob URL.
// - Owner-only URLs (profiles) and reserved paths are NOT repositories.

const RESERVED_OWNERS = new Set([
  "about", "apps", "collections", "customer-stories", "enterprise", "events", "explore", "features",
  "issues", "login", "marketplace", "new", "notifications", "orgs", "pricing", "pulls", "readme",
  "search", "security", "settings", "sponsors", "team", "topics", "trending", "users", "site", "git-guides",
]);
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const FILE_RE = /\.[A-Za-z0-9]{1,6}$/;

export const SHORTENER_HOSTS = new Set([
  "t.co", "bit.ly", "tinyurl.com", "goo.gl", "ow.ly", "buff.ly", "is.gd", "cutt.ly", "rb.gy", "lnkd.in", "shorturl.at", "t.ly",
]);

/** Pull URLs out of free text / markdown. Returns de-duplicated, trailing-punctuation-trimmed URLs. */
export function extractUrls(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const re = /https?:\/\/[^\s<>"'`\])}]+/gi;
  let m;
  while ((m = re.exec(text))) {
    let u = m[0].replace(/[.,;:!?*_]+$/g, "");
    // markdown "[text](url)" leaves a trailing ")" handled by the char class; balance a lone "("
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

function safeUrl(raw) {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Canonicalise a GitHub URL.
 * @returns {{kind:'repo', key:string, owner:string, repo:string, subpath:string|null, url:string}
 *   | {kind:'not_repo', reason:string} | null} null when not a github.com URL
 */
export function canonicalGithub(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  let host = u.hostname.toLowerCase().replace(/^www\./, "");
  const segs = u.pathname.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  if (host === "gist.github.com") return { kind: "not_repo", reason: "gist" };
  if (host === "raw.githubusercontent.com") {
    if (segs.length < 3) return { kind: "not_repo", reason: "raw_incomplete" };
    const [owner, repo, , ...rest] = segs;
    return build(owner, repo, rest.length ? (FILE_RE.test(rest[rest.length - 1]) ? rest.slice(0, -1) : rest) : []);
  }
  if (host !== "github.com") return null;
  if (segs.length === 0) return { kind: "not_repo", reason: "root" };
  const owner = segs[0];
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return { kind: "not_repo", reason: "reserved_path" };
  if (segs.length === 1) return { kind: "not_repo", reason: "profile_only" };
  let repo = segs[1];
  let sub = [];
  const marker = segs[2];
  if ((marker === "tree" || marker === "blob") && segs.length >= 4) {
    sub = segs.slice(4);
    if (marker === "blob" && sub.length && FILE_RE.test(sub[sub.length - 1])) sub = sub.slice(0, -1);
  }
  return build(owner, repo, sub);

  function build(o, r, subSegs) {
    r = r.replace(/\.git$/i, "");
    if (!OWNER_RE.test(o) || !REPO_RE.test(r) || r === "." || r === "..") return { kind: "not_repo", reason: "invalid_name" };
    const subpath = subSegs.length ? subSegs.join("/").toLowerCase() : null;
    const base = `github.com/${o.toLowerCase()}/${r.toLowerCase()}`;
    return {
      kind: "repo", owner: o, repo: r, subpath,
      key: subpath ? `${base}/${subpath}` : base,
      url: `https://github.com/${o}/${r}${subpath ? `/tree/HEAD/${subSegs.join("/")}` : ""}`,
    };
  }
}

export function repoKeyOnly(key) {
  return key.split("/").slice(0, 3).join("/");
}

/** Classify a URL for the normalised record. */
export function classifyUrl(raw) {
  const u = safeUrl(raw);
  if (!u) return { type: "invalid" };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const gh = canonicalGithub(raw);
  if (gh) return gh.kind === "repo" ? { type: "github_repo", ...gh } : { type: "github_other", reason: gh.reason };
  if (SHORTENER_HOSTS.has(host)) return { type: "shortener", host };
  if (host === "npmjs.com" || host === "npmjs.org") {
    const m = u.pathname.match(/^\/package\/((?:@[^/]+\/)?[^/]+)/);
    return m ? { type: "npm", id: `npm:${m[1].toLowerCase()}` } : { type: "other", host };
  }
  if (host === "pypi.org") {
    const m = u.pathname.match(/^\/project\/([^/]+)/);
    return m ? { type: "pypi", id: `pypi:${normalizePypi(m[1])}` } : { type: "other", host };
  }
  if (host === "hub.docker.com") {
    const m = u.pathname.match(/^\/(?:r|_)\/([^/]+\/[^/]+|[^/]+)/);
    return m ? { type: "docker", id: `docker:${m[1].toLowerCase()}` } : { type: "other", host };
  }
  if (host === "crates.io") {
    const m = u.pathname.match(/^\/crates\/([^/]+)/);
    return m ? { type: "crates", id: `crates:${m[1].toLowerCase()}` } : { type: "other", host };
  }
  if (host === "smithery.ai" || host === "glama.ai" || host === "mcp.so" || host === "registry.modelcontextprotocol.io" || host === "pulsemcp.com" || host === "mcpservers.org") {
    return { type: "directory_listing", host, path: u.pathname };
  }
  if (host.endsWith(".github.io")) return { type: "homepage", host };
  return { type: "other", host };
}

export function normalizePypi(n) {
  return n.toLowerCase().replace(/[-_.]+/g, "-");
}

/** Remote MCP endpoints conventionally end in /mcp, /sse or /mcp/. */
export function looksLikeMcpEndpoint(raw) {
  const u = safeUrl(raw);
  if (!u) return false;
  return /\/(mcp|sse|mcp\/sse|v1\/mcp|api\/mcp)\/?$/i.test(u.pathname) || /(^|\.)mcp\./i.test(u.hostname);
}

/** Endpoint identity: scheme-less host + path, no query/fragment/trailing slash, lower-case host. */
export function endpointKey(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  return `endpoint:${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
}

/**
 * Hosts we must never contact (SSRF hygiene) — also used as a security flag when
 * a submission advertises such an endpoint.
 */
export function isRestrictedHost(hostname) {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".onion")) return true;
  if (h === "metadata.google.internal" || h === "metadata" || h === "instance-data") return true;
  if (/^\[.*\]$/.test(h) || h.includes(":")) return true; // IPv6 literals
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) return true; // any IPv4 literal: refuse (private, link-local, metadata, or otherwise opaque)
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true; // integer/hex IPv4 forms
  return false;
}
