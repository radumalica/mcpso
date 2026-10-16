#!/usr/bin/env node
// Stage 4b — snapshot of the official MCP Registry (registry.modelcontextprotocol.io),
// used as an independent external reference: a project listed there has a
// namespace-verified publisher. Read-only, paginated, polite (sequential, 250 ms spacing).
//   node tools/upstream-import/registry-snapshot.mjs --out data/upstream-import
// Output: <out>/enrichment/official-registry.jsonl  (latest version per server name)
//   {name, title, description, version, repository_url, repository_key, remotes[], packages[], status, is_latest}
// Caveat: "listed in the official registry" ≠ "verified working/secure".

import path from "node:path";
import { parseArgs } from "node:util";
import { writeJsonlAtomic, ensureDir, makeLogger } from "./lib/store.mjs";
import { canonicalGithub, endpointKey } from "./lib/urls.mjs";
import { backoffDelay } from "./lib/github.mjs";

const BASE = "https://registry.modelcontextprotocol.io/v0/servers";

async function getPage(cursor, log) {
  const url = `${BASE}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "mcp-registry-upstream-import/0.1" }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 200) return await res.json();
      log({ level: "warn", event: "registry_http", status: res.status, attempt });
    } catch (e) { log({ level: "warn", event: "registry_network", attempt, error: String(e.message) }); }
    await new Promise((r) => setTimeout(r, backoffDelay(attempt, { baseMs: 1500 })));
  }
  throw new Error("official registry unavailable after retries");
}

export async function main(argv = process.argv.slice(2)) {
  const { values: a } = parseArgs({ args: argv, options: { out: { type: "string", default: "data/upstream-import" }, quiet: { type: "boolean", default: false }, "max-pages": { type: "string", default: "2000" } } });
  const out = path.resolve(a.out);
  ensureDir(path.join(out, "enrichment"));
  const log = makeLogger(path.join(out, "logs", `registry-${new Date().toISOString().replace(/[:.]/g, "-")}.log`), { quiet: a.quiet });
  const byName = new Map();
  let cursor = null, pages = 0, seen = 0;
  do {
    const j = await getPage(cursor, log);
    for (const item of j.servers || []) {
      seen++;
      const s = item.server || {};
      const meta = item._meta?.["io.modelcontextprotocol.registry/official"] || {};
      const repoUrl = s.repository?.url || null;
      const g = repoUrl ? canonicalGithub(repoUrl) : null;
      const rec = {
        name: s.name, title: s.title ?? null, description: s.description ? String(s.description).slice(0, 300) : null, version: s.version ?? null,
        repository_url: repoUrl, repository_key: g?.kind === "repo" ? g.key : null, repository_subfolder: s.repository?.subfolder ?? null,
        remotes: (s.remotes || []).map((r) => ({ type: r.type, url: r.url, key: endpointKey(r.url) })),
        packages: (s.packages || []).map((p) => ({ registry: p.registryType, id: p.identifier, version: p.version })),
        status: meta.status ?? null, is_latest: meta.isLatest ?? null, updated_at: meta.updatedAt ?? null,
      };
      const prev = byName.get(rec.name);
      if (!prev || (rec.is_latest && !prev.is_latest) || (rec.is_latest === prev.is_latest && String(rec.updated_at) > String(prev.updated_at))) byName.set(rec.name, rec);
    }
    cursor = j.metadata?.nextCursor || null;
    pages++;
    if (pages % 10 === 0) log({ event: "registry_progress", pages, seen, unique: byName.size });
    await new Promise((r) => setTimeout(r, 250));
  } while (cursor && pages < Number(a["max-pages"]));
  writeJsonlAtomic(path.join(out, "enrichment", "official-registry.jsonl"), [...byName.values()]);
  log({ event: "registry_done", pages, entries_seen: seen, unique_servers: byName.size, truncated_by_page_cap: !!cursor });
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(JSON.stringify({ event: "fatal", error: String(e.message || e) })); process.exit(1); });
