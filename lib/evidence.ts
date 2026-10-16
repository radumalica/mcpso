// Evidence levels and the exact public wording required by the publication policy (reports/publication-gate-checklist.md §2).
// A test compares these strings with tools/upstream-import/lib/gates.mjs so the two cannot drift apart.
export type EvidenceLevel = 0 | 1 | 2;

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  0: "Declared only",
  1: "Repository facts checked",
  2: "Static inspection",
};

export const EVIDENCE_WORDING: Record<EvidenceLevel, string> = {
  0: "Declared only: this entry comes from a publisher or registry declaration dated {date}. The registry has not checked the server or its repository.",
  1: "Repository facts checked on {date} (exists, public, licence, last activity); any manifest or registry entry is the publisher's own declaration. The server has not been tested or security-reviewed.",
  2: "Static inspection on {date}: the repository depends on an MCP SDK and describes itself as a server. The server has not been tested or security-reviewed.",
};

/** Words that must never describe a listing at launch (policy: forbidden wording). */
export const FORBIDDEN_WORDS = ["verified", "safe", "secure", "trusted", "recommended"] as const;

export function toEvidenceLevel(value: unknown): EvidenceLevel {
  return value === 1 || value === 2 ? value : 0; // anything unknown is treated as the weakest level
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "an unknown date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "an unknown date" : d.toISOString().slice(0, 10);
}

/** The required wording for a level with the check date filled in. */
export function evidenceWording(level: EvidenceLevel, checkedAt: string | null | undefined): string {
  return EVIDENCE_WORDING[level].replace("{date}", formatDate(checkedAt));
}
