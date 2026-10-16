#!/usr/bin/env node
// Scans every tracked file for credential-shaped strings. Exit code 1 if anything is found; findings print file, line and rule only,
// never the matched value. Usage: node tools/ci/secret-scan.mjs [--files a,b,c]   (default: all files tracked by version control)
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export const RULES = [
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained-token", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: "openai-style-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private-key-block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "service-role-assignment", re: /\bSUPABASE_SERVICE(?:_ROLE)?_KEY\s*[=:]\s*["']?[A-Za-z0-9._-]{20,}/ },
  { id: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/ },
];

export function scanText(text) {
  const findings = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 20000) continue; // minified blobs
    for (const r of RULES) if (r.re.test(lines[i])) findings.push({ line: i + 1, rule: r.id });
  }
  return findings;
}

export function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
}

export function scanFiles(files) {
  const out = [];
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(f); } catch { continue; } // deleted in the working tree
    if (buf.includes(0)) continue; // binary
    for (const x of scanText(buf.toString("utf8"))) out.push({ file: f, ...x });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--files");
  const files = i > -1 ? process.argv[i + 1].split(",") : trackedFiles();
  const findings = scanFiles(files);
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.rule}`);
  console.log(findings.length ? `${findings.length} potential secret(s) in ${files.length} files` : `no secrets found in ${files.length} files`);
  process.exit(findings.length ? 1 : 0);
}
