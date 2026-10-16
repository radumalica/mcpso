// Read-only access to the public read model. The only relation this module touches is the `public_listing` view
// (published, importable, not suppressed; reviewer-approved text and tier 1/2 facts only). It never writes.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Listing, PAGE_SIZE, SLUG_RE, parseListing } from "@/lib/listing";
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
  const page = Math.max(1, opts.page ?? 1);
  const term = sanitizeSearchTerm(opts.q ?? "");
  let query = db().from("public_listing").select(COLUMNS, { count: "exact" });
  if (!opts.includeDeclared) query = query.gte("evidence_level", 1);
  if (term) query = query.or(`title.ilike.%${term}%,summary.ilike.%${term}%`);
  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.order("title", { ascending: true }).order("slug", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  if (error) throw new DataUnavailableError("the catalogue could not be read");
  const listings = (data ?? []).map(parseListing).filter((l): l is Listing => l !== null);
  return { listings, total: count ?? listings.length, page, pageSize: PAGE_SIZE };
}

export async function getListing(slug: string): Promise<Listing | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { data, error } = await db().from("public_listing").select(COLUMNS).eq("slug", slug).maybeSingle();
  if (error) throw new DataUnavailableError("the listing could not be read");
  return parseListing(data);
}

/** Slugs and publication dates for the sitemap (bounded). Declared-only entries are not advertised to crawlers. */
export async function listSitemapEntries(limit = 5000): Promise<{ slug: string; publishedAt: string | null }[]> {
  const { data, error } = await db().from("public_listing").select("slug,published_at").gte("evidence_level", 1).order("slug").limit(limit);
  if (error) throw new DataUnavailableError("the sitemap could not be built");
  return (data ?? [])
    .filter((r) => typeof r.slug === "string" && SLUG_RE.test(r.slug))
    .map((r) => ({ slug: r.slug as string, publishedAt: typeof r.published_at === "string" ? r.published_at : null }));
}
