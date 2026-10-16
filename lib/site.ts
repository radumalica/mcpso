// Site identity and operator contact. All values come from server-side environment variables (read at runtime, so one build serves any environment) so that no name, domain or address is hard-coded
// before the owner decisions D1 (name, domain) and D2 (hosting) are made. The default name is a working title, not a brand.
const trimSlash = (u: string) => u.replace(/\/+$/, "");

export const site = {
  name: process.env.SITE_NAME || "MCP Registry (working title)",
  url: trimSlash(process.env.SITE_URL || "http://localhost:3000"),
  contactEmail: process.env.CONTACT_EMAIL || "",
  description:
    "An independent directory of Model Context Protocol (MCP) servers. Every entry shows what was checked, when, and what was not.",
} as const;

export const NON_AFFILIATION =
  "This directory is independent. It is not affiliated with, endorsed by or sponsored by Anthropic, the Model Context Protocol project, or the publishers of the listed servers. Names and marks belong to their owners.";

/** Absolute URL for a site path. */
export function absoluteUrl(path: string): string {
  return `${site.url}${path.startsWith("/") ? path : `/${path}`}`;
}
