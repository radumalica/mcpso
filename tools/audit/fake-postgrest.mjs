// Minimal fake PostgREST (Supabase REST) for UI/behaviour review WITHOUT touching a real database.
// Serves synthetic fixtures and logs every request URL/headers it receives (to see exactly what the app sends).
//   node tools/audit/fake-postgrest.mjs <port> <logfile>
import http from "node:http";
import fs from "node:fs";

const port = Number(process.argv[2] || 54321);
const logFile = process.argv[3] || "postgrest-requests.log";
const cats = [
  ["developer-tools", "Developer Tools"], ["databases", "Databases"], ["browser-automation", "Browser Automation"],
  ["search", "Search"], ["finance", "Finance"], ["security", "Security"],
].map(([name, title], i) => ({ id: i + 1, name, title, status: "created", created_at: "2025-01-01T00:00:00Z" }));
const projects = Array.from({ length: 40 }, (_, i) => ({
  uuid: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `fixture-${i}`, title: `Fixture Server ${i}${i % 7 === 0 ? " with a deliberately very long title to test wrapping behaviour in cards" : ""}`,
  description: i % 5 === 0 ? null : `Synthetic MCP server number ${i}. ` + "Lorem ipsum dolor sit amet. ".repeat(1 + (i % 6)),
  avatar_url: i % 3 === 0 ? "https://example.invalid/avatar.png" : null, created_at: new Date(Date.now() - i * 864e5 * 9).toISOString(), updated_at: new Date().toISOString(),
  status: "created", author_name: `author${i}`, tags: "alpha,beta,gamma", category: cats[i % cats.length].name, is_featured: true, sort: 1,
  url: `https://github.com/example/fixture-${i}`, target: "_self",
  content: "# readme", summary: i % 2 ? `## what is Fixture ${i}?\nA synthetic server.\n\n## how to use?\n\`\`\`bash\nnpx -y fixture-${i}\n\`\`\`\n\n<script>alert('md')</script>\n\n[bad](javascript:alert(1))` : null,
  img_url: null,
}));

http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`);
  fs.appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), method: req.method, path: decodeURIComponent(u.pathname + u.search), accept: req.headers.accept, range: req.headers.range, prefer: req.headers.prefer, hasApikey: !!req.headers.apikey }) + "\n");
  const table = u.pathname.replace("/rest/v1/", "");
  let rows = table === "projects" ? projects : table === "categories" ? cats : [];
  const sel = u.searchParams.get("select");
  const eq = (k) => { const v = u.searchParams.get(k); return v && v.startsWith("eq.") ? v.slice(3) : null; };
  for (const k of ["name", "uuid", "category"]) if (eq(k)) rows = rows.filter((r) => String(r[k]) === eq(k));
  if (req.method !== "GET") { res.writeHead(201, { "content-type": "application/json" }); return res.end("[]"); }
  if (sel === "count") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify([{ count: rows.length }])); }
  const single = (req.headers.accept || "").includes("vnd.pgrst.object");
  const range = (req.headers.range || "").match(/(\d+)-(\d+)/);
  if (range) rows = rows.slice(Number(range[1]), Number(range[2]) + 1);
  if (single) {
    if (rows.length !== 1) { res.writeHead(406, { "content-type": "application/json" }); return res.end(JSON.stringify({ code: "PGRST116", message: "no rows" })); }
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(rows[0]));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(rows));
}).listen(port, "127.0.0.1", () => console.log(`fake postgrest on ${port}`));
