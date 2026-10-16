import type { Listing } from "@/lib/listing";
import { EVIDENCE_LABEL, evidenceWording } from "@/lib/evidence";

/** The required wording for the listing's evidence level, always shown with its date. */
export function EvidenceNote({ listing }: { listing: Listing }) {
  return (
    <aside aria-labelledby="evidence-h" className="rounded border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
      <h2 id="evidence-h" className="text-base font-semibold">What was checked: {EVIDENCE_LABEL[listing.evidenceLevel]}</h2>
      <p className="mt-2 text-sm">{evidenceWording(listing.evidenceLevel, listing.evidenceCheckedAt)}</p>
    </aside>
  );
}
