// Site identity and operator contact. All values come from server-side environment variables (read at runtime, so one build serves any environment) so that no name, domain or address is hard-coded
// before the owner decisions D1 (name, domain) and D2 (hosting) are made. The default name is a working title, not a brand.
const FALLBACK_URL = "http://localhost:3000";
const production = () => process.env.NODE_ENV === "production";

/** SITE_URL must be an absolute http(s) URL without credentials. Anything else is reported by siteProblems() and replaced by a placeholder. */
function parseSiteUrl(raw: string | undefined): { url: string; problem: string | null } {
  if (!raw) return { url: FALLBACK_URL, problem: production() ? "SITE_URL is not set" : null };
  try {
    const u = new URL(raw);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) {
      return { url: FALLBACK_URL, problem: "SITE_URL must be an absolute http(s) URL without credentials" };
    }
    if (production() && (u.protocol !== "https:" || /^(localhost|127\.|\[::1\])/i.test(u.hostname))) {
      return { url: u.origin, problem: "SITE_URL must be a public https URL in production" };
    }
    return { url: u.origin, problem: null };
  } catch {
    return { url: FALLBACK_URL, problem: "SITE_URL is not a valid URL" };
  }
}

const parsed = parseSiteUrl(process.env.SITE_URL);

export const site = {
  name: process.env.SITE_NAME || "MCP Registry (working title)",
  url: parsed.url,
  contactEmail: process.env.CONTACT_EMAIL || "",
  description:
    "An independent directory of Model Context Protocol (MCP) servers. Every entry shows what was checked, when, and what was not.",
} as const;

/** Configuration problems that make the site misleading if served (wrong canonical URLs, no removal contact). Empty when fine. Names only, never values. */
export function siteProblems(): string[] {
  const out: string[] = [];
  if (parsed.problem) out.push(parsed.problem);
  if (production() && !site.contactEmail) out.push("CONTACT_EMAIL is not set (the removal page has no contact)");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) out.push("SUPABASE_URL or SUPABASE_ANON_KEY is not set");
  return out;
}

if (production()) for (const p of siteProblems()) console.error(`[config] ${p}`);

export const NON_AFFILIATION =
  "This directory is independent. It is not affiliated with, endorsed by or sponsored by Anthropic, the Model Context Protocol project, or the publishers of the listed servers. Names and marks belong to their owners.";

/** Absolute URL for a site path. */
export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
