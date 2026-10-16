// Append-only JSONL stores with last-write-wins compaction, atomic JSON state
// files, and a structured logger. No dependencies.

import fs from "node:fs";
import path from "node:path";
import { redact } from "./github.mjs";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      out.push(JSON.parse(lines[i]));
    } catch {
      // A torn final line from a crash is ignored; earlier lines are intact.
      if (i < lines.length - 2) throw new Error(`corrupt JSONL at ${file}:${i + 1}`);
    }
  }
  return out;
}

export function appendJsonl(file, records) {
  if (!records.length) return;
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function writeJsonlAtomic(file, records) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
  fs.renameSync(tmp, file);
}

/** Rewrite file keeping only the last record per key, sorted by key function. */
export function compactJsonl(file, keyOf, sortKey) {
  const map = new Map();
  for (const r of readJsonl(file)) map.set(keyOf(r), r);
  let rows = [...map.values()];
  if (sortKey) rows = rows.sort((a, b) => sortKey(a) - sortKey(b));
  writeJsonlAtomic(file, rows);
  return rows.length;
}

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/**
 * CSV cell escaping with spreadsheet formula-injection protection: cells that start with
 * `=`, `+`, `-`, `@`, TAB or CR are prefixed with a single quote so Excel/Sheets treat them as text.
 * (Submitter-controlled text ends up in these files.)
 */
export function csvCell(v) {
  let s = Array.isArray(v) ? v.join("; ") : v ?? "";
  s = String(s);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(file, cols, rows, { privateCols = [] } = {}) {
  const write = (f, cs) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, [cs.join(","), ...rows.map((r) => cs.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n"); };
  if (!privateCols.length) return write(file, cols);
  // Public-safe view (committed): personal handles and submitter-authored names removed. The full view stays in an ignored
  // private/ sibling directory for reviewers (policy: reports/publication-gate-checklist.md section 5, question Q2).
  write(file, cols.filter((c) => !privateCols.includes(c)));
  write(path.join(path.dirname(file), "private", path.basename(file)), cols);
}

/** JSONL with the same public/private split: the public file omits `privateKeys`; the private/ copy keeps everything. */
export function writeJsonlPublicPrivate(file, rows, privateKeys = []) {
  const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !privateKeys.includes(k)));
  writeJsonlAtomic(file, rows.map(strip));
  fs.mkdirSync(path.join(path.dirname(file), "private"), { recursive: true });
  writeJsonlAtomic(path.join(path.dirname(file), "private", path.basename(file)), rows);
}

export function makeLogger(logFile, { quiet = false } = {}) {
  ensureDir(path.dirname(logFile));
  return (evt) => {
    const line = redact(JSON.stringify({ ts: new Date().toISOString(), ...evt }));
    fs.appendFileSync(logFile, line + "\n");
    if (!quiet) process.stderr.write(line + "\n");
  };
}
