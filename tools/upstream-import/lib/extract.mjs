// Deterministic extraction of submission claims from issue / comment text.
// No LLM involved. All input is UNTRUSTED text: it is only pattern-matched,
// never evaluated, fetched, or executed here.

import {
  canonicalGithub, classifyUrl, extractUrls, looksLikeMcpEndpoint, endpointKey, isRestrictedHost, normalizePypi,
} from "./urls.mjs";

const LABELS = {
  name: ["name", "server name", "project", "project name", "title", "mcp server", "server"],
  repo: ["repository", "repo", "github", "source", "source code", "code", "github repo", "github repository", "git", "github url", "repository url", "repo url"],
  url: ["url", "link", "links", "homepage", "website", "web", "site", "docs", "documentation", "home page", "product page"],
  endpoint: ["endpoint", "mcp endpoint", "server url", "remote url", "remote endpoint", "mcp url", "remote server", "streamable http", "sse endpoint", "hosted endpoint", "mcp server url"],
  transport: ["transport", "type", "server type", "connection"],
  license: ["license", "licence"],
  npm: ["npm", "npm package", "npx", "package"],
  pypi: ["pypi", "pip", "pypi package", "python package"],
  install: ["install", "installation", "command", "run", "usage", "quick start", "install command", "how to install"],
  auth: ["auth", "authentication", "authorization", "api key", "credentials"],
  category: ["category", "categories", "tags", "tag"],
  description: ["description", "summary", "about", "one-liner", "short description", "what it does", "overview"],
  registry: ["registry name", "mcp registry", "registry", "official registry", "namespace", "registry id"],
  tools: ["tools", "available tools", "capabilities", "features"],
  language: ["language", "lang", "runtime", "stack"],
};
const LABEL_TO_FIELD = new Map();
for (const [f, ls] of Object.entries(LABELS)) for (const l of ls) if (!LABEL_TO_FIELD.has(l)) LABEL_TO_FIELD.set(l, f);

const clean = (s) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$2 $1").replace(/\s+/g, " ").trim();

/** Parse `**Label:** value`, `- Label: value`, `Label: value` and `### Label\nvalue` blocks. */
export function parseKeyValues(body) {
  const kv = []; // preserve order and duplicates: [{label, value, line}]
  if (!body) return kv;
  const lines = body.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "### Label" followed by value on following non-empty lines
    const h = line.match(/^\s{0,3}#{1,6}\s+(.{1,40}?)\s*:?\s*$/);
    if (h) {
      const label = clean(h[1]).toLowerCase();
      if (LABEL_TO_FIELD.has(label)) {
        const vals = [];
        for (let j = i + 1; j < lines.length && vals.length < 12; j++) {
          if (/^\s{0,3}#{1,6}\s/.test(lines[j])) break;
          if (lines[j].trim()) vals.push(lines[j].trim());
        }
        if (vals.length) kv.push({ label, value: vals.join("\n"), line: i + 1 });
      }
      continue;
    }
    const m = line.match(/^\s*(?:[-*+]\s+|\d+\.\s+)?(?:\*\*|__)?([A-Za-z][A-Za-z0-9 /_.()-]{0,40}?)(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*(.*)$/);
    if (m) {
      const label = clean(m[1]).toLowerCase();
      if (LABEL_TO_FIELD.has(label)) kv.push({ label, value: m[2].trim(), line: i + 1 });
    }
  }
  return kv;
}

/** Strip common submission-title prefixes and trailing descriptions. */
export function nameFromTitle(title) {
  if (!title) return null;
  let t = title.trim();
  t = t.replace(/^\s*[\[(][^\])]{1,30}[\])]\s*/i, ""); // [Submit] / [New Server]
  t = t.replace(/^(?:please\s+)?(?:submit|add|new|list|register|request|listing)(?:\s+(?:remote|hosted|local|new))?(?:\s+mcp(?:\s+server)?|\s+server)?\s*(?:request)?\s*[:\-–—]?\s*/i, "");
  t = t.replace(/\s+(?:to|on|in|for)\s+(?:mcp\.so|the\s+directory|mcp\s+directory)\s*$/i, "");
  t = t.split(/\s+[—–]\s+|\s+--\s+|\s+-\s+(?=[A-Z])/)[0];
  t = t.replace(/\s*\((?:https?:\/\/|io\.github|com\.|ai\.|studio\.|@)[^)]*\)\s*$/i, "");
  t = clean(t);
  return t.length >= 2 && t.length <= 120 ? t : null;
}

const TRANSPORT_PATTERNS = [
  ["streamable-http", /streamable[\s_-]?http|streamablehttp/i],
  ["sse", /\bsse\b|server-sent events/i],
  ["stdio", /\bstdio\b/i],
  ["http", /\bhttps?\s+(?:transport|endpoint)\b|\bremote\b/i],
];

export function detectTransports(text) {
  const out = [];
  for (const [name, re] of TRANSPORT_PATTERNS) if (re.test(text) && name !== "http") out.push(name);
  if (!out.length && /\bremote\b/i.test(text)) out.push("remote-unspecified");
  return out;
}

const INSTALL_RE = /\b(?:npx\s+(?:-y\s+)?[@\w./-]+|uvx\s+[\w./-]+|pipx?\s+install\s+[\w./-]+|pip3?\s+install\s+[\w./-]+|docker\s+run\s+[^\n`]+|npm\s+(?:i|install)\s+(?:-g\s+)?[@\w./-]+|go\s+install\s+[\w./@-]+|cargo\s+install\s+[\w-]+|dotnet\s+tool\s+install\s+[\w.-]+|bunx\s+[@\w./-]+|deno\s+run\s+[^\n`]+)/i;

export function detectInstall(text) {
  const m = text.match(INSTALL_RE);
  return m ? m[0].trim().slice(0, 200) : null;
}

const PROXY_PACKAGES = new Set(["mcp-remote", "supergateway", "mcp-proxy", "@modelcontextprotocol/inspector", "mcp-publisher", "@smithery/cli", "@anthropic-ai/mcpb"]);
const NPM_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

function firstValueUrls(entries) {
  return entries.flatMap((e) => extractUrls(e.value));
}

/**
 * @param {string} title
 * @param {string} body
 * @returns {object} claims plus per-field evidence
 */
export function extractClaims(title, body) {
  const text = `${title || ""}\n${body || ""}`;
  const kv = parseKeyValues(body || "");
  const by = (field) => kv.filter((e) => LABEL_TO_FIELD.get(e.label) === field);
  const evidence = {};
  const ev = (field, source, snippet) => { (evidence[field] ||= []).push({ source, snippet: String(snippet).slice(0, 160) }); };

  // --- repository identity candidates (ordered by trust in the label) ---
  const repoCandidates = [];
  const pushRepo = (url, source) => {
    const g = canonicalGithub(url);
    if (g && g.kind === "repo" && !repoCandidates.some((c) => c.key === g.key)) {
      repoCandidates.push({ key: g.key, owner: g.owner, repo: g.repo, subpath: g.subpath, url: g.url, source });
    }
  };
  for (const e of by("repo")) for (const u of extractUrls(e.value)) { pushRepo(u, `label:${e.label}`); }
  for (const e of by("url")) for (const u of extractUrls(e.value)) { pushRepo(u, `label:${e.label}`); }
  for (const u of extractUrls(title || "")) pushRepo(u, "title");
  for (const u of extractUrls(body || "")) pushRepo(u, "body");
  // "owner/repo" shorthand inside a repo label
  for (const e of by("repo")) {
    const m = e.value.replace(/[`*]/g, "").match(/^\s*([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\s*$/);
    if (m) pushRepo(`https://github.com/${m[1]}/${m[2]}`, `label:${e.label}`);
  }
  const labeledRepoKeys = new Set(
    [...by("repo"), ...by("url")].flatMap((e) => extractUrls(e.value).map((u) => canonicalGithub(u)).filter((g) => g?.kind === "repo").map((g) => g.key)),
  );
  const primary = repoCandidates[0] || null;
  if (primary) ev("repo", primary.source, primary.url);

  // --- other URLs ---
  const allUrls = extractUrls(text);
  const classified = allUrls.map((u) => ({ url: u, ...classifyUrl(u) }));
  const packageIds = new Set();
  for (const c of classified) if (c.id) packageIds.add(c.id);
  for (const e of by("npm")) {
    const v = clean(e.value).replace(/^npx\s+(-y\s+)?/i, "").split(/\s+/)[0];
    if (v && NPM_NAME_RE.test(v) && !/^https?:/i.test(v)) { packageIds.add(`npm:${v.toLowerCase()}`); ev("package", `label:${e.label}`, v); }
  }
  for (const e of by("pypi")) {
    const v = clean(e.value).replace(/^(?:uvx|pipx?\s+install|pip3?\s+install)\s+/i, "").split(/\s+/)[0];
    if (v && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) { packageIds.add(`pypi:${normalizePypi(v)}`); ev("package", `label:${e.label}`, v); }
  }
  const installCmd = detectInstall(text);
  const dropProxy = () => { for (const id of [...packageIds]) if (id.startsWith("npm:") && PROXY_PACKAGES.has(id.slice(4))) packageIds.delete(id); };
  if (installCmd) {
    ev("install", "text", installCmd);
    const npx = installCmd.match(/^(?:npx\s+(?:-y\s+)?|npm\s+(?:i|install)\s+(?:-g\s+)?|bunx\s+)(@?[a-z0-9][\w./@-]*)/i);
    if (npx && NPM_NAME_RE.test(npx[1].replace(/@[\d^~][\w.-]*$/, ""))) packageIds.add(`npm:${npx[1].replace(/@[\d^~][\w.-]*$/, "").toLowerCase()}`);
    const py = installCmd.match(/^(?:uvx\s+|pipx?\s+install\s+|pip3?\s+install\s+)([A-Za-z0-9][\w.-]*)/i);
    if (py) packageIds.add(`pypi:${normalizePypi(py[1])}`);
  }

  dropProxy();

  // --- remote endpoints ---
  const endpoints = [];
  const addEndpoint = (u, source) => {
    const c = classifyUrl(u);
    if (c.type !== "other" && c.type !== "homepage") return;
    let host; try { host = new URL(u).hostname; } catch { return; }
    if (/^(docs|doc|developer|developers|blog|status)\./i.test(host) || /\/(docs?|api-reference|reference|guide|blog)\//i.test(new URL(u).pathname + "/")) return;
    if (!endpoints.some((x) => x.url === u)) endpoints.push({ url: u, key: endpointKey(u), restricted: isRestrictedHost(host), source });
  };
  for (const e of by("endpoint")) for (const u of extractUrls(e.value)) addEndpoint(u, `label:${e.label}`);
  for (const c of classified) if (looksLikeMcpEndpoint(c.url)) addEndpoint(c.url, "pattern");
  if (endpoints[0]) ev("endpoint", endpoints[0].source, endpoints[0].url);

  // --- homepage (first non-github, non-endpoint, non-package URL in url-ish labels) ---
  let homepage = null;
  for (const u of firstValueUrls(by("url"))) {
    const c = classifyUrl(u);
    if ((c.type === "other" || c.type === "homepage") && !looksLikeMcpEndpoint(u)) { homepage = u; ev("homepage", "label", u); break; }
  }

  // --- names / description / misc ---
  const labeledName = by("name").map((e) => clean(e.value)).find((v) => v && v.length <= 120 && !/^https?:/i.test(v));
  const titleName = nameFromTitle(title);
  const firstLine = (body || "").replace(/\r/g, "").split("\n").map((l) => l.trim()).find((l) => /^(#{1,6}\s+|\*\*)[^:\n]{2,80}$/.test(l));
  const headingName = firstLine ? clean(firstLine.replace(/^#{1,6}\s+/, "")) : null;
  const name = labeledName || titleName || headingName || (primary ? primary.repo : null);
  if (name) ev("name", labeledName ? "label" : titleName ? "title" : headingName ? "heading" : "repo-name", name);

  let description = null;
  const d = by("description")[0];
  if (d) description = clean(d.value).slice(0, 600);
  if (!description) {
    // first prose paragraph that is not a heading, label line, list item or URL-only
    const paras = (body || "").replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const p = paras.find((x) => !/^#|^[-*>|`]|^\*\*[^*]+:\*\*|^\w[\w ]{0,25}:\s|^https?:\/\/\S+$/.test(x) && x.length > 30);
    if (p) description = clean(p).slice(0, 600);
  }
  if (description) ev("description", d ? "label" : "first-paragraph", description);

  const toolsEntry = by("tools")[0];
  const noToolsListed = /_?no tools listed\.?_?/i.test(body || "");
  const toolNames = new Set();
  const toolSection = (body || "").match(/(?:^|\n)\s*(?:#{1,6}\s*|\*\*)\s*(?:available\s+)?tools[^\n]*\n([\s\S]{0,2500}?)(?:\n\s*#{1,6}\s|\n\s*\*\*[A-Z][^\n]*:\*\*|$)/i);
  const toolText = toolSection ? toolSection[1] : toolsEntry ? toolsEntry.value : "";
  for (const m of toolText.matchAll(/`([a-z][a-z0-9_.:-]{2,60})`/gi)) toolNames.add(m[1]);

  const licenseEntry = by("license")[0];
  let license = licenseEntry ? clean(licenseEntry.value).slice(0, 60) : null;
  if (!license) {
    const m = text.match(/\b(MIT|Apache[- ]2\.0|BSD-[23]-Clause|GPL-?3(?:\.0)?|AGPL-?3(?:\.0)?|LGPL-?[23](?:\.\d)?|MPL-2\.0|ISC|Unlicense)\b/);
    if (m) license = m[1];
  }

  const authEntry = by("auth")[0];
  let auth = authEntry ? clean(authEntry.value).slice(0, 120) : null;
  if (!auth) {
    if (/\boauth\b/i.test(text)) auth = "oauth (mentioned)";
    else if (/\bapi[ _-]?key\b/i.test(text)) auth = "api-key (mentioned)";
    else if (/\bno (?:auth|authentication|api key)\b/i.test(text)) auth = "none (stated)";
  }

  const category = by("category")[0] ? clean(by("category")[0].value).slice(0, 120) : null;
  const registryName = by("registry")[0] ? clean(by("registry")[0].value).split(/\s+/)[0] : (text.match(/\b(io\.github\.[\w.-]+\/[\w.-]+|(?:com|ai|studio|dev|app|org|net|io)\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\/[a-z0-9._-]+)/i)?.[1] || null);

  const transports = detectTransports(`${by("transport").map((e) => e.value).join(" ")} ${text}`);
  const hasStdio = transports.includes("stdio") || (!!installCmd && !endpoints.length);
  const hasRemote = endpoints.length > 0 || transports.some((t) => t === "sse" || t === "streamable-http" || t === "remote-unspecified");
  const hosting = hasRemote && hasStdio ? "both" : hasRemote ? "remote" : hasStdio ? "local" : null;

  const shorteners = classified.filter((c) => c.type === "shortener").map((c) => c.url);

  return {
    name, repo_candidates: repoCandidates, repo_key: primary?.key ?? null, repo_url: primary?.url ?? null,
    repo_owner: primary?.owner ?? null, repo_name: primary?.repo ?? null, repo_subpath: primary?.subpath ?? null,
    labeled_repo_keys: [...labeledRepoKeys],
    homepage, endpoints, package_ids: [...packageIds].sort(), install_command: installCmd,
    transports, hosting, license, description, auth, category, registry_name: registryName,
    tools: [...toolNames].slice(0, 50), tools_explicitly_empty: noToolsListed,
    shortener_urls: shorteners,
    mcp_so_slugs: [...new Set([...text.matchAll(/mcp\.so\/server\/([\w.%-]+)/gi)].map((m) => decodeURIComponent(m[1]).toLowerCase()))],
    all_urls_count: allUrls.length,
    other_github_urls: classified.filter((c) => c.type === "github_repo" && c.key !== primary?.key).map((c) => c.key),
    evidence,
  };
}

/**
 * Classify what the author is asking for. Conservative: anything not clearly
 * a submission is routed to review/ineligible, never silently imported.
 */
export function classifyIntent({ title, body, claims, sourceType }) {
  const t = `${title || ""}`.toLowerCase();
  const b = `${body || ""}`.toLowerCase();
  const text = `${t}\n${b}`;
  if (!(body || "").trim() && !(title || "").trim()) return { intent: "empty", reason: "empty title and body" };
  if (sourceType === "pull_request") return { intent: "code_contribution", reason: "pull request (code change), not a submission channel" };
  const removal = /\b(remove|delete|take\s*down|unlist|de-?list|opt[- ]?out)\b[^.\n]{0,60}\b(my|our|the|this)?\s*(listing|server|entry|project|page|mcp)\b|how can i (remove|delete)|please (remove|delete)\b/.test(`${t} ${b.slice(0, 400)}`);
  if (removal && !/\b(submit|add)\b[^.\n]{0,20}\bmcp server\b/.test(t)) return { intent: "removal_request", reason: "asks to remove/unlist a listing" };
  const correction = /\b(link|url|repo(?:sitory)?)\b[^.\n]{0,40}\b(changed|moved|renamed|is now|updated|incorrect|wrong|broken)\b|\b(correct|updated|new)\s+(link|url|repo)/.test(`${t} ${b.slice(0, 400)}`);
  const hasId = !!(claims.repo_key || claims.endpoints.length || claims.package_ids.length || claims.homepage);
  if (correction && hasId && /mcp\.so\/server\//.test(b)) return { intent: "link_correction", reason: "references an existing mcp.so listing and supplies a replacement link" };
  const submissionish = /\b(submit|add|list|register|new)\b/.test(t) || /mcp server|\bmcp\b/.test(text);
  if (hasId && submissionish) return { intent: "submission", reason: "has an identifying link and submission wording" };
  if (hasId) return { intent: "submission_unclear", reason: "has an identifying link but no submission wording" };
  if (/\?|\b(how|why|can you|could you|bug|error|issue|feature|request|suggest|idea)\b/.test(text) && !hasId) return { intent: "question_or_feedback", reason: "no identifying link; reads as question/feedback" };
  return { intent: "no_identity", reason: "no repository, endpoint, package or homepage found" };
}
