import Link from "next/link";
import { catalogueHref } from "@/lib/listing";

export function Pagination({ page, pages, q, declared }: { page: number; pages: number; q?: string; declared?: boolean }) {
  if (pages <= 1) return null;
  const link = "rounded border border-[color:var(--line)] px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link rel="prev" className={link} href={catalogueHref({ q, declared, page: page - 1 })}>Previous</Link>
      ) : (
        <span aria-hidden="true" />
      )}
      <p className="text-sm" aria-current="page">Page {page} of {pages}</p>
      {page < pages ? (
        <Link rel="next" className={link} href={catalogueHref({ q, declared, page: page + 1 })}>Next</Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
