// View model for published listings. Everything coming from the database is treated as untrusted: it is validated and
// coerced here, rendered only as text (React escapes it), and external links are limited to http(s).
import { type EvidenceLevel, toEvidenceLevel } from "./evidence.ts";

export interface SourceLink {
  url: string;
  kind: string;
  retrievedAt: string | null;
}

export interface ListingFacts {
  repoUrl: string | null;
  homepage: string | null;
  endpoints: string[];
  packageIds: string[];
  installCommand: string | null;
  hosting: string | null;
  transports: string[];
  licence: string | null;
  repoLicence: string | null;
  repoPushedAt: string | null;
  repoName: string | null;
  archived: boolean;
  fork: boolean;
}

export interface Listing {
  slug: string;
  title: string;
  summary: string;
  facts: ListingFacts;
  evidenceLevel: EvidenceLevel;
  evidenceCheckedAt: string | null;
  sourceLinks: SourceLink[];
  publishedAt: string | null;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
export const PAGE_SIZE = 24;
const MAX_TEXT = 2000;

// Untrusted text may carry bidirectional overrides (U+202E, U+2066-2069), zero-width and other invisible format characters that make
// displayed text differ from what is copied. Line breaks become spaces; every other control or format character is removed.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
export const cleanText = (v: string): string => v.replace(/[\r\n\t]+/g, " ").replace(INVISIBLE, "").trim();
const str = (v: unknown, max = MAX_TEXT): string | null => {
  if (typeof v !== "string") return null;
  const t = cleanText(v).slice(0, max);
  return t ? t : null;
};
const strList = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, 300)).filter((x): x is string => x !== null).slice(0, max) : [];

/** Returns a normalised http(s) URL or null. Rejects javascript:, data:, credentials in the URL and malformed input. */
export function safeExternalUrl(value: unknown): string | null {
  const s = str(value, 2048);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function parseFacts(raw: unknown): ListingFacts {
  const f = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const repo = f.repo && typeof f.repo === "object" ? (f.repo as Record<string, unknown>) : {};
  return {
    repoUrl: safeExternalUrl(f.repo_url),
    homepage: safeExternalUrl(f.homepage),
    endpoints: strList(f.endpoints),
    packageIds: strList(f.package_ids),
    installCommand: str(f.install_command, 500),
    hosting: str(f.hosting, 100),
    transports: strList(f.transports, 10),
    licence: str(f.license_claimed, 100),
    repoLicence: str(repo.license, 100),
    repoPushedAt: str(repo.pushed_at, 40),
    repoName: str(repo.name_with_owner, 200),
    archived: repo.archived === true,
    fork: repo.fork === true,
  };
}

/** Validates one `public_listing` row. Returns null for a row that cannot be shown safely (bad slug, empty title or summary). */
export function parseListing(row: unknown): Listing | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const slug = typeof r.slug === "string" && SLUG_RE.test(r.slug) ? r.slug : null;
  const title = str(r.title, 200);
  const summary = str(r.summary);
  if (!slug || !title || !summary) return null;
  const links = Array.isArray(r.source_links) ? r.source_links : [];
  const sourceLinks: SourceLink[] = [];
  for (const l of links.slice(0, 20)) {
    const o = l && typeof l === "object" ? (l as Record<string, unknown>) : {};
    const url = safeExternalUrl(o.url);
    if (url) sourceLinks.push({ url, kind: str(o.kind, 30) ?? "source", retrievedAt: str(o.retrieved_at, 40) });
  }
  return {
    slug,
    title,
    summary,
    facts: parseFacts(r.facts),
    evidenceLevel: toEvidenceLevel(r.evidence_level),
    evidenceCheckedAt: str(r.evidence_checked_at, 40),
    sourceLinks,
    publishedAt: str(r.published_at, 40),
  };
}

/** Page number from a query value: 1 for anything that is not a positive integer, capped to keep ranges sane. */
export function parsePage(value: unknown): number {
  const s = Array.isArray(value) ? value[0] : value;
  const n = typeof s === "string" && /^\d{1,6}$/.test(s) ? Number(s) : 1;
  return n >= 1 ? n : 1;
}

export function pageCount(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Query string for a catalogue page; empty values are omitted so URLs stay canonical. */
export function catalogueHref(params: { q?: string; page?: number; declared?: boolean }): string {
  const p = new URLSearchParams();
  if (params.q) p.set("q", params.q);
  if (params.declared) p.set("declared", "1");
  if (params.page && params.page > 1) p.set("page", String(params.page));
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}
