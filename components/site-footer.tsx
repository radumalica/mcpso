import Link from "next/link";
import { NON_AFFILIATION, site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-[color:var(--line)]">
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-6 text-sm text-[color:var(--muted)]">
        <p>{NON_AFFILIATION}</p>
        <p>
          Listing text is written for this directory; facts come from public sources and are labelled with how and when they were checked.
          A listing is not an endorsement, a review of the code, or a statement that the software is safe to run.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/about" className="underline">How entries are chosen</Link>
          <Link href="/removal" className="underline">Removal and corrections</Link>
          <Link href="/privacy" className="underline">Privacy</Link>
          <Link href="/terms" className="underline">Terms</Link>
          {site.contactEmail ? <a href={`mailto:${site.contactEmail}`} className="underline">Contact</a> : null}
        </nav>
      </div>
    </footer>
  );
}
