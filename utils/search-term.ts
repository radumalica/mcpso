export const MAX_SEARCH_TERM_LENGTH = 200;

// Characters that carry meaning inside a PostgREST `or(...)` filter string or a LIKE pattern. A search term is
// user input and is interpolated into such a string, so these are removed rather than escaped: escaping rules
// differ between PostgREST versions and a keyword search never needs them.
const FILTER_SYNTAX = /[,()"'`\\%_*:;<>{}[\]|&=]/g;

/** Returns a term that is safe to embed in an ilike filter, or "" when nothing searchable remains. */
export function sanitizeSearchTerm(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(FILTER_SYNTAX, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_TERM_LENGTH)
    .trim();
}
