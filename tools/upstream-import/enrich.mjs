#!/usr/bin/env node
// Stage 4 — repository metadata & MCP-evidence enrichment (read-only, no code execution).
//   GITHUB_TOKEN=... node tools/upstream-import/enrich.mjs --out data/upstream-import [--use-gh-token]
//
// For each unique GitHub repository claimed by a submission, one batched GraphQL
// query fetches repository facts and the TEXT of a few manifests/README. The text
// is only regex-scanned locally for MCP SDK dependencies; it is never executed,
// installed, or stored (only derived features and short snippets are kept).
// Resumable: finished repos are skipped on re-run (--refresh to redo all).

import path from "node:path";
import { parseArgs } from "node:util";
import { GitHubClient, GitHubError, resolveToken, backoffDelay, redact } from "./lib/github.mjs";
import { appendJsonl, compactJsonl, makeLogger, readJsonl, ensureDir } from "./lib/store.mjs";

const BATCH = 20;
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SUBPATH_RE = /^[A-Za-z0-9._/-]{1,200}$/; // git path lookups are case-sensitive: keep the submitter's case

/** Subpath safe to interpolate into a GraphQL string literal (no quotes, backslashes, `..` segments). */
export function safeSubpath(s) {
  if (!s || !SUBPATH_RE.test(s) || s.split("/").some((seg) => seg === ".." || seg === "")) return null;
  return s;
}

/**
 * Evaluation target for a project: original-case owner/repo/subpath where the submitted URL is
 * available and agrees with the lower-cased canonical key, else the canonical key's parts.
 */
export function targetFromProject(p) {
  const [, keyOwner, keyRepo, ...keySub] = p.canonical_key.split("/");
  let owner = keyOwner, repo = keyRepo, subpath = keySub.length ? keySub.join("/") : null;
  const m = String(p.merged_claims?.repo_url || "").match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)(?:\/tree\/[^/]+\/(.+?))?\/?$/i);
  if (m) {
    const o = m[1], r = m[2].replace(/\.git$/i, "");
    if (o.toLowerCase() === keyOwner && r.toLowerCase() === keyRepo) {
      owner = o; repo = r;
      if (subpath && m[3] && m[3].toLowerCase() === subpath) subpath = m[3];
    }
  }
  return { requested_key: p.canonical_key, owner, repo, subpath };
}

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "server.json"];

// SDK/framework dependencies. NOTE: a dependency proves MCP *involvement*, not that the project is a
// server (clients also depend on the SDK); classify.mjs therefore requires "server wording" too.
const NPM_SDK = [/^@modelcontextprotocol\/sdk$/, /^@modelcontextprotocol\/server-/, /^fastmcp$/, /^mcp-framework$/, /^mcp-handler$/, /^@vercel\/mcp-adapter$/, /^xmcp$/, /^@hono\/mcp$/, /^mcp-lite$/, /^@leanmcp\//, /^fastmcp-ts$/];
const PY_NAMES = "mcp|fastmcp|fastapi[-_]mcp|modelcontextprotocol";
const PY_REQ_LINE = new RegExp(`^\\s*(?:${PY_NAMES})(?:\\[[^\\]]*\\])?\\s*(?:[<>=!~;@#]|$)`, "im"); // requirements.txt line
const PY_QUOTED_DEP = new RegExp(`^\\s*(?:${PY_NAMES})(?:\\[[^\\]]*\\])?\\s*(?:[<>=!~;@]|$)`, "i"); // one PEP 508 string

/** Read a TOML array body starting just after '['; quote- and comment-aware. */
function readTomlArray(text, i) {
  let depth = 1, q = null, out = "";
  for (; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q) q = null; out += c; continue; }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === "#") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
    out += c;
  }
  return out;
}

/** PEP 508 requirement strings from the *dependency* parts of a pyproject.toml (not keywords, name, scripts). */
export function pyprojectRequirements(text) {
  const reqs = [];
  let table = "", off = 0;
  for (const line of text.split("\n")) {
    const lineStart = off; off += line.length + 1;
    const th = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (th) { table = th[1].trim(); continue; }
    const kv = line.match(/^\s*([A-Za-z0-9_."-]+)\s*=\s*(\[|[^\s#].*)?/);
    if (!kv) continue;
    const key = kv[1].replace(/"/g, "");
    const groupTable = table === "project.optional-dependencies" || table === "dependency-groups";
    if ((key === "dependencies" || groupTable) && /=\s*\[/.test(line)) {
      const body = readTomlArray(text, lineStart + line.indexOf("[", line.indexOf("=")) + 1);
      for (const m of body.matchAll(/(["'])((?:(?!\1).)*)\1/g)) reqs.push(m[2]);
    } else if (/^tool\.poetry\.(group\.[^.]+\.)?dependencies$/.test(table)) {
      reqs.push(key); // poetry: `name = "^1.0"`
    }
  }
  return reqs;
}
const GO_SDK = /github\.com\/(modelcontextprotocol\/go-sdk|mark3labs\/mcp-go|metoro-io\/mcp-golang|ThinkInAIXYZ\/go-mcp|strowk\/foxy-contexts)/i;
const RUST_SDK = /^\s*(rmcp|mcp[-_]sdk|rust[-_]mcp[-_]sdk|mcp[-_]rs|mcp[-_]core)\b/im;
const JVM_SDK = /io\.modelcontextprotocol|spring-ai-.*mcp|mcp-sdk|koog.*mcp/i;
const MCP_TOPICS = new Set(["mcp", "mcp-server", "mcp-servers", "model-context-protocol", "modelcontextprotocol", "mcp-client", "mcp-tools", "mcp-tool"]);

const FRAGMENT = (alias, owner, name, subpath) => {
  const objs = MANIFESTS.map((m, i) => `m${i}: object(expression: "HEAD:${m}") { ... on Blob { byteSize text } }`);
  objs.push(`readme: object(expression: "HEAD:README.md") { ... on Blob { byteSize text } }`);
  if (subpath) {
    for (const [i, m] of ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "server.json"].entries()) objs.push(`s${i}: object(expression: "HEAD:${subpath}/${m}") { ... on Blob { byteSize text } }`);
    objs.push(`sreadme: object(expression: "HEAD:${subpath}/README.md") { ... on Blob { byteSize text } }`);
    objs.push(`sdir: object(expression: "HEAD:${subpath}") { __typename }`);
  }
  return `${alias}: repository(owner: "${owner}", name: "${name}") {
    nameWithOwner url isArchived isFork isTemplate isEmpty isPrivate isDisabled? pushedAt createdAt stargazerCount description
    licenseInfo { spdxId name } primaryLanguage { name } repositoryTopics(first: 20) { nodes { topic { name } } }
    defaultBranchRef { name } parent { nameWithOwner }
    ${objs.join("\n    ")}
  }`.replace("isDisabled? ", "");
};

export function scanManifests(text, file) {
  const hits = [];
  if (!text) return hits;
  if (file === "package.json") {
    try {
      const j = JSON.parse(text);
      const deps = { ...j.dependencies, ...j.devDependencies, ...j.peerDependencies, ...j.optionalDependencies };
      for (const d of Object.keys(deps)) if (NPM_SDK.some((re) => re.test(d))) hits.push(`npm-dep:${d}`);
      if (typeof j.mcpName === "string" && j.mcpName) hits.push("package.json:mcpName"); // official-registry namespace claim
    } catch { if (/@modelcontextprotocol\/sdk|fastmcp/.test(text)) hits.push("npm-dep:text-match"); }
  } else if (file === "pyproject.toml") {
    if (pyprojectRequirements(text).some((r) => PY_QUOTED_DEP.test(r))) hits.push("py-dep:pyproject.toml");
  } else if (file === "requirements.txt") {
    if (PY_REQ_LINE.test(text)) hits.push("py-dep:requirements.txt");
  } else if (file === "go.mod") {
    const m = text.match(GO_SDK); if (m) hits.push(`go-dep:${m[1]}`);
  } else if (file === "Cargo.toml") {
    if (RUST_SDK.test(text)) hits.push("rust-dep");
  } else if (file === "pom.xml" || file.startsWith("build.gradle")) {
    if (JVM_SDK.test(text)) hits.push(`jvm-dep:${file}`);
  } else if (file === "server.json") {
    try {
      const j = JSON.parse(text);
      const schemaOk = String(j.$schema || "").includes("modelcontextprotocol");
      const nsName = typeof j.name === "string" && /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/i.test(j.name); // reverse-DNS/name, e.g. io.github.user/server
      if (schemaOk || (nsName && (Array.isArray(j.packages) || Array.isArray(j.remotes)))) hits.push("server.json:registry-manifest");
    } catch { /* invalid JSON: no evidence */ }
  }
  return hits;
}

function derive(node, subpath) {
  const text = (k) => node?.[k]?.text || null;
  const evidence = [];
  MANIFESTS.forEach((m, i) => { for (const h of scanManifests(text(`m${i}`), m)) evidence.push({ scope: "root", signal: h }); });
  if (subpath) {
    ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "server.json"].forEach((m, i) => { for (const h of scanManifests(text(`s${i}`), m)) evidence.push({ scope: "subpath", signal: h }); });
  }
  const topics = (node.repositoryTopics?.nodes || []).map((n) => n.topic.name);
  const mcpTopics = topics.filter((t) => MCP_TOPICS.has(t));
  // Root and subpath evidence are kept strictly separate: a monorepo's root README/manifests say nothing
  // about a server living in a subdirectory, and vice versa.
  const readme = text("readme") || "";
  const subReadme = subpath ? text("sreadme") || "" : "";
  const MENTION = /.{0,50}(model context protocol|\bmcp[- ](?:server|tool|client)s?\b).{0,50}/is;
  const m = readme.match(MENTION);
  const ms = subReadme.match(MENTION);
  const descMention = /model context protocol|\bmcp\b/i.test(node.description || "");
  // Wording that says the project IS a server (as opposed to a client/host or a library that uses MCP).
  const SERVER_WORD = /\bmcp[- ]servers?\b|\bmodel context protocol servers?\b|\bserver (?:for|implementing|exposing) (?:the )?model context protocol\b/i;
  const serverWording = [];
  for (const t of topics) if (/^mcp-servers?(-|$)/.test(t) || t === "model-context-protocol-server") serverWording.push(`topic:${t}`);
  if (SERVER_WORD.test(node.description || "")) serverWording.push("description");
  if (SERVER_WORD.test(readme)) serverWording.push("readme");
  const serverWordingSub = SERVER_WORD.test(subReadme) ? ["subpath-readme"] : [];
  return {
    resolved: true,
    canonical_key: `github.com/${node.nameWithOwner.toLowerCase()}`,
    name_with_owner: node.nameWithOwner,
    url: node.url, archived: node.isArchived, fork: node.isFork, fork_parent: node.parent?.nameWithOwner ?? null,
    template: node.isTemplate, empty: node.isEmpty, private: node.isPrivate,
    pushed_at: node.pushedAt, created_at: node.createdAt, stars: node.stargazerCount,
    description: node.description ? node.description.slice(0, 300) : null,
    license_spdx: node.licenseInfo?.spdxId ?? null, license_name: node.licenseInfo?.name ?? null,
    primary_language: node.primaryLanguage?.name ?? null,
    topics, mcp_topics: mcpTopics,
    default_branch: node.defaultBranchRef?.name ?? null,
    manifests_present: MANIFESTS.filter((mm, i) => node[`m${i}`]),
    evaluated_subpath: subpath,
    subpath_exists: subpath ? !!node.sdir : null,
    sdk_evidence: evidence, // each entry has scope "root" | "subpath"
    readme_bytes: node.readme?.byteSize ?? 0,
    subpath_readme_bytes: subpath ? node.sreadme?.byteSize ?? 0 : null,
    readme_mcp_mention: m ? m[0].replace(/\s+/g, " ").trim().slice(0, 120) : null,
    subpath_readme_mcp_mention: ms ? ms[0].replace(/\s+/g, " ").trim().slice(0, 120) : null,
    description_mentions_mcp: descMention,
    server_wording: serverWording,
    server_wording_subpath: serverWordingSub,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const { values: a } = parseArgs({ args: argv, options: {
    out: { type: "string", default: "data/upstream-import" }, "use-gh-token": { type: "boolean", default: false },
    refresh: { type: "boolean", default: false }, "max-batches": { type: "string" }, quiet: { type: "boolean", default: false },
  } });
  const out = path.resolve(a.out);
  const log = makeLogger(path.join(out, "logs", `enrich-${new Date().toISOString().replace(/[:.]/g, "-")}.log`), { quiet: a.quiet });
  const token = resolveToken({ useGh: a["use-gh-token"] });
  if (!token) throw new Error("GraphQL requires a token: set GITHUB_TOKEN or pass --use-gh-token");
  const client = new GitHubClient({ token, log });
  const projects = readJsonl(path.join(out, "dedup", "projects.pre-enrichment.jsonl"));
  const file = path.join(out, "enrichment", "repos.jsonl");
  ensureDir(path.dirname(file));
  // Resume: rows from failed queries are NOT "done" (a transient 502 must not become a permanent "missing repository").
  const isFinal = (r) => r.reason !== "query_failed" && !String(r.reason || "").startsWith("error:");
  const done = new Set(a.refresh ? [] : readJsonl(file).filter(isFinal).map((r) => r.requested_key));

  // One evaluation per (repository, subpath) = one per project canonical key; no result is shared between
  // sibling subpath projects or between a repo-level project and its subpath projects.
  const targets = new Map();
  for (const p of projects) {
    if (p.identity_type !== "github_repo") continue;
    const t = targetFromProject(p);
    targets.set(t.requested_key, t);
  }
  const todo = [...targets.entries()].filter(([k]) => !done.has(k));
  log({ event: "enrich_start", targets: targets.size, distinct_repos: new Set([...targets.values()].map((t) => `${t.owner}/${t.repo}`.toLowerCase())).size, todo: todo.length });

  let batches = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const valid = ([, t]) => OWNER_RE.test(t.owner) && REPO_RE.test(t.repo);
    const chunk = todo.slice(i, i + BATCH).filter(valid);
    const invalid = todo.slice(i, i + BATCH).filter((x) => !valid(x));
    appendJsonl(file, invalid.map(([k]) => ({ requested_key: k, resolved: false, reason: "invalid_name", checked_at: new Date().toISOString() })));
    if (!chunk.length) continue;
    const parts = chunk.map(([, t], idx) => FRAGMENT(`r${idx}`, t.owner, t.repo, safeSubpath(t.subpath)));
    const body = JSON.stringify({ query: `query { ${parts.join("\n")} rateLimit { cost remaining resetAt } }` });
    let json;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch("https://api.github.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "mcp-registry-upstream-import/0.1" }, body, signal: AbortSignal.timeout(90_000) });
        if (res.status === 200) { json = await res.json(); break; }
        const txt = redact((await res.text()).slice(0, 200));
        log({ level: "warn", event: "graphql_http", status: res.status, attempt, body: txt });
        if (res.status === 403 || res.status === 429) await new Promise((r) => setTimeout(r, Math.min(300_000, 30_000 * 2 ** attempt)));
        else await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
      } catch (e) { log({ level: "warn", event: "graphql_network", attempt, error: redact(e.message) }); await new Promise((r) => setTimeout(r, backoffDelay(attempt))); }
    }
    if (!json?.data) { log({ level: "error", event: "batch_failed", first: chunk[0][0] }); appendJsonl(file, chunk.map(([k]) => ({ requested_key: k, resolved: false, reason: "query_failed", checked_at: new Date().toISOString() }))); continue; }
    const errs = new Map((json.errors || []).filter((e) => e.path?.[0]).map((e) => [e.path[0], e]));
    const rows = chunk.map(([k, t], idx) => {
      const node = json.data[`r${idx}`];
      const base = { requested_key: k, requested: `${t.owner}/${t.repo}`, checked_at: new Date().toISOString() };
      if (!node) {
        const e = errs.get(`r${idx}`);
        return { ...base, resolved: false, reason: e?.type === "NOT_FOUND" ? "not_found_or_private" : `error:${e?.type || "null"}` };
      }
      return { ...base, ...derive(node, safeSubpath(t.subpath)), renamed: node.nameWithOwner.toLowerCase() !== `${t.owner}/${t.repo}`.toLowerCase() };
    });
    appendJsonl(file, rows);
    batches++;
    log({ event: "batch", n: batches, repos: rows.length, resolved: rows.filter((r) => r.resolved).length, cost: json.data.rateLimit?.cost, remaining: json.data.rateLimit?.remaining });
    if (json.data.rateLimit?.remaining < 200) {
      const wait = Math.max(0, Date.parse(json.data.rateLimit.resetAt) - Date.now()) + 2000;
      log({ level: "warn", event: "graphql_budget_wait", wait_s: Math.round(wait / 1000) });
      await new Promise((r) => setTimeout(r, wait));
    }
    if (a["max-batches"] && batches >= Number(a["max-batches"])) break;
  }
  const n = compactJsonl(file, (r) => r.requested_key);
  log({ event: "enrich_done", records: n });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(JSON.stringify({ event: "fatal", error: redact(e.message || e) })); process.exit(1); });
}
