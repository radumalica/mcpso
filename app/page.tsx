import type { Metadata } from "next";
import { ListingCard } from "@/components/listing-card";
import { Pagination } from "@/components/pagination";
import { SearchForm } from "@/components/search-form";
import { pageCount, parsePage } from "@/lib/listing";
import { site } from "@/lib/site";
import { searchListings } from "@/models/listing";
import { sanitizeSearchTerm } from "@/utils/search-term";

// Database-backed: rendered per request, never prerendered at build time.
export const dynamic = "force-dynamic";

type Search = { [key: string]: string | string[] | undefined };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  const q = sanitizeSearchTerm(first(sp.q) ?? "");
  // Search result pages are not indexed; the plain catalogue is.
  return q || first(sp.declared) || parsePage(sp.page) > 1 ? { title: q ? `Search: ${q}` : "Browse", robots: { index: false, follow: true } } : { title: site.name };
}

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = sanitizeSearchTerm(first(sp.q) ?? "");
  const declared = first(sp.declared) === "1";
  const page = parsePage(sp.page);
  const result = await searchListings({ q, page, includeDeclared: declared });
  const pages = pageCount(result.total, result.pageSize);

  return (
    <>
      <h1 className="text-3xl font-bold">{site.name}</h1>
      <p className="mt-2 max-w-2xl text-[color:var(--muted)]">{site.description}</p>
      <div className="mt-6 max-w-2xl">
        <SearchForm q={q} declared={declared} />
      </div>
      <p className="mt-6 text-sm" role="status">
        {result.total === 0 ? "No entries match." : `${result.total} ${result.total === 1 ? "entry" : "entries"}${q ? ` for “${q}”` : ""}.`}
      </p>
      {result.listings.length > 0 ? (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {result.listings.map((l) => (
            <ListingCard key={l.slug} listing={l} />
          ))}
        </ul>
      ) : null}
      <Pagination page={Math.min(page, pages)} pages={pages} q={q} declared={declared} />
    </>
  );
}
