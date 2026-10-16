import test from "node:test";
import assert from "node:assert/strict";
import { scanText, RULES } from "../../tools/ci/secret-scan.mjs";

// Test credentials are assembled at run time so this file itself never contains a credential-shaped literal.
const fake = {
  "github-token": "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "github-fine-grained-token": "github_pat_" + "B".repeat(55),
  "openai-style-key": "sk-" + "c".repeat(40),
  "aws-access-key-id": "AKIA" + "ABCDEFGHIJKLMNOP",
  "private-key-block": "-----BEGIN " + "RSA PRIVATE KEY-----",
  jwt: "eyJ" + "hbGciOiJIUzI1NiJ9" + "." + "eyJ" + "zdWIiOiIxMjM0NTY3ODkw" + "." + "abcdefghij0123456789",
  "service-role-assignment": "SUPABASE_SERVICE_ROLE_KEY=" + "d".repeat(30),
  "slack-token": "xoxb-" + "1234567890-abcdefghij",
};

test("every rule detects its credential shape and reports the rule and line, never the value", () => {
  for (const r of RULES) {
    const hits = scanText(`line one\nvalue ${fake[r.id]} here\n`);
    assert.deepEqual(hits, [{ line: 2, rule: r.id }], r.id);
  }
});

test("ordinary text, short identifiers and placeholders are not flagged", () => {
  const ok = ["ghp_ is a prefix", "sk-short", "SUPABASE_SERVICE_ROLE_KEY=", "SUPABASE_URL=https://example.test", "const token = process.env.GITHUB_TOKEN;", "AKIA is not enough", "eyJ.eyJ.x"];
  for (const line of ok) assert.deepEqual(scanText(line), [], line);
});
