// Static, text-only security indicators for submissions. These are REVIEW
// signals, not verdicts: they never mean a project is malicious, and their
// absence never means a project is safe.

const INJECTION_PATTERNS = [
  [/ignore (?:all |any )?(?:the )?(?:previous|prior|above) (?:instructions|prompts?)/i, "ignore-previous-instructions"],
  [/disregard (?:all |any )?(?:the )?(?:previous|prior|above|your) (?:instructions|rules)/i, "disregard-instructions"],
  [/(?:^|\n)\s*(?:system|assistant)\s*:\s/i, "role-marker"],
  [/<\|(?:im_start|im_end|system|endoftext)\|>/i, "chat-template-token"],
  [/\byou are now\b.{0,40}\b(?:an?|the)\b/i, "persona-override"],
  [/\b(?:reveal|print|show|exfiltrate)\b.{0,30}\b(?:system prompt|api[_ -]?key|secrets?|credentials|environment variables)\b/i, "secret-exfil-request"],
  [/\bwhen (?:an? )?(?:ai|llm|assistant|agent|model) (?:reads|sees|processes) this\b/i, "addresses-ai-reader"],
];

const SHELL_PIPE = /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|\biex\s*\(|\bpowershell\b[^\n]{0,40}-(?:enc|encodedcommand)\b|\bbase64\s+-d\b[^\n]{0,80}\|\s*(?:ba)?sh/i;
const SECRET_REQUEST = /\b(?:send|paste|share|provide|enter|upload)\b[^.\n]{0,40}\b(?:private key|seed phrase|mnemonic|recovery phrase|wallet password)\b/i;
const HIDDEN_UNICODE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const LONG_BASE64 = /[A-Za-z0-9+/]{240,}={0,2}/;
export function isLoopbackUrl(raw) {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h === "localhost" || h.endsWith(".localhost") || h === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch { return false; }
}
const OFFICIAL_SCOPES = [["@modelcontextprotocol/", ["modelcontextprotocol"]], ["@anthropic-ai/", ["anthropics"]], ["@anthropic/", ["anthropics"]]];

/**
 * @param {string} text title+body
 * @param {object} claims output of extractClaims
 * @returns {{code:string, detail:string}[]}
 */
export function securityFlags(text, claims) {
  const flags = [];
  const t = text || "";
  for (const [re, code] of INJECTION_PATTERNS) {
    const m = t.match(re);
    if (m) flags.push({ code: `prompt_injection_phrase:${code}`, detail: m[0].trim().slice(0, 100) });
  }
  const sp = t.match(SHELL_PIPE);
  if (sp) flags.push({ code: "pipe_to_shell_install", detail: sp[0].slice(0, 100) });
  const sr = t.match(SECRET_REQUEST);
  if (sr) flags.push({ code: "requests_private_key_or_seed", detail: sr[0].slice(0, 100) });
  if (HIDDEN_UNICODE.test(t)) flags.push({ code: "hidden_unicode_characters", detail: "zero-width or bidi control characters present" });
  if (LONG_BASE64.test(t)) flags.push({ code: "long_encoded_blob", detail: "base64-like string of 240+ chars" });
  for (const e of claims.endpoints || []) {
    // Loopback URLs are ordinary "run it locally" documentation, not a security signal (they are
    // still never contacted). Other restricted hosts (public/private IP literals, metadata
    // hostnames, .internal/.local/.onion) are review triggers: a registry listing should not
    // advertise a bare IP or an internal name as a server endpoint.
    if (e.restricted && !isLoopbackUrl(e.url)) flags.push({ code: "restricted_endpoint_target", detail: e.url.slice(0, 100) });
  }
  if ((claims.shortener_urls || []).length) flags.push({ code: "shortened_link", detail: claims.shortener_urls[0] });
  for (const id of claims.package_ids || []) {
    for (const [prefix, owners] of OFFICIAL_SCOPES) {
      if (id.startsWith(`npm:${prefix}`) && !owners.includes((claims.repo_owner || "").toLowerCase())) {
        flags.push({ code: "official_scope_impersonation_possible", detail: `${id} claimed; repo owner is ${claims.repo_owner || "unknown"}` });
      }
    }
  }
  return flags;
}
