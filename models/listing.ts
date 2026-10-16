// Read-only access to the public read model. The only relation this module touches is the `public_listing` view
// (published, importable, not suppressed; reviewer-approved text and tier 1/2 facts only). It never writes.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Listing, PAGE_SIZE, SLUG_RE, pageCount, parseListing } from "@/lib/listing";
import { sanitizeSearchTerm } from "@/utils/search-term";

const COLUMNS = "slug,title,summary,facts,evidence_level,evidence_checked_at,source_links,published_at";

export class DataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataUnavailableError";
  }
}

let client: SupabaseClient | null = null;

function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new DataUnavailableError("the data source is not configured");
  client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export interface CataloguePage {
  listings: Listing[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One page of the catalogue. Level 0 ("declared only") entries are excluded unless `includeDeclared` is set
 * (policy: hidden from the default view). A database error is thrown, never turned into an empty list.
 */
export async function searchListings(opts: { q?: string; page?: number; includeDeclared?: boolean } = {}): Promise<CataloguePage> {
  const term = sanitizeSearchTerm(opts.q ?? "");
  const run = async (page: number) => {
    let query = db().from("public_listing").select(COLUMNS, { count: "exact" });
    if (!opts.includeDeclared) query = query.gte("evidence_level", 1);
    if (term) query = query.or(`title.ilike.%${term}%,summary.ilike.%${term}%`);
    const from = (page - 1) * PAGE_SIZE;
    return query.order("title", { ascending: true }).order("slug", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  };
  let page = Math.max(1, opts.page ?? 1);
  let res = await run(page);
  // PostgREST answers 416 / PGRST103 when the offset is past the last row (a stale link, ?page=99999, page 2 of an empty search).
  // That is not an outage: look up the real total and serve the last page instead.
  if (res.error && isRangeError(res.error)) {
    const first = await run(1);
    if (first.error) throw new DataUnavailableError("the catalogue could not be read");
    page = pageCount(first.count ?? 0);
    res = page === 1 ? first : await run(page);
  }
  const { data, error, count } = res;
  if (error) throw new DataUnavailableError("the catalogue could not be read");
  const listings = (data ?? []).map(parseListing).filter((l): l is Listing => l !== null);
  return { listings, total: count ?? listings.length, page, pageSize: PAGE_SIZE };
}

function isRangeError(e: { code?: string; message?: string }): boolean {
  return e.code === "PGRST103" || /range not satisfiable/i.test(e.message ?? "");
}

export async function getListing(slug: string): Promise<Listing | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { data, error } = await db().from("public_listing").select(COLUMNS).eq("slug", slug).maybeSingle();
  if (error) throw new DataUnavailableError("the listing could not be read");
  return parseListing(data);
}

/**
 * Slugs and publication dates for the sitemap, read in pages of 1000 (PostgREST caps a response at its max-rows setting, so a
 * single large request would be silently truncated). Declared-only entries are not advertised to crawlers.
 */
export async function listSitemapEntries(limit = 45000): Promise<{ slug: string; publishedAt: string | null }[]> {
  const out: { slug: string; publishedAt: string | null }[] = [];
  const step = 1000;
  for (let from = 0; from < limit; from += step) {
    const { data, error } = await db().from("public_listing").select("slug,published_at").gte("evidence_level", 1).order("slug").range(from, from + step - 1);
    if (error) {
      if (isRangeError(error)) break; // past the end
      throw new DataUnavailableError("the sitemap could not be built");
    }
    for (const r of data ?? []) {
      if (typeof r.slug === "string" && SLUG_RE.test(r.slug)) out.push({ slug: r.slug, publishedAt: typeof r.published_at === "string" ? r.published_at : null });
    }
    if ((data ?? []).length < step) break;
  }
  return out;
}
