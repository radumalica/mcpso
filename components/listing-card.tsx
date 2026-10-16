import Link from "next/link";
import type { Listing } from "@/lib/listing";
import { EVIDENCE_LABEL, formatDate } from "@/lib/evidence";

export function ListingCard({ listing }: { listing: Listing }) {
  const { facts } = listing;
  return (
    <li className="rounded border border-[color:var(--line)] p-4">
      <h2 className="text-lg font-semibold">
        <Link href={`/s/${listing.slug}`} className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {listing.title}
        </Link>
      </h2>
      <p className="mt-1 line-clamp-3 text-sm">{listing.summary}</p>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[color:var(--muted)]">
        <span>
          Evidence: {EVIDENCE_LABEL[listing.evidenceLevel]}, {formatDate(listing.evidenceCheckedAt)}
        </span>
        {facts.licence ? <span>Licence (as declared): {facts.licence}</span> : null}
        {facts.archived ? <span>Repository archived</span> : null}
      </p>
    </li>
  );
}
