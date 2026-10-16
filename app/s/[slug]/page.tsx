import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceNote } from "@/components/evidence-note";
import { formatDate } from "@/lib/evidence";
import { hostOf } from "@/lib/listing";
import { absoluteUrl } from "@/lib/site";
import { getListing } from "@/models/listing";

// Database-backed: rendered per request, never prerendered at build time.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListing(slug);
  if (!listing) return { title: "Not found", robots: { index: false } };
  return {
    title: listing.title,
    description: listing.summary.slice(0, 200),
    alternates: { canonical: absoluteUrl(`/s/${listing.slug}`) },
    // Declared-only entries are reachable but not indexed.
    robots: listing.evidenceLevel === 0 ? { index: false, follow: true } : undefined,
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  const listing = await getListing(slug);
  if (!listing) notFound();
  const f = listing.facts;
  const external = "underline";
  const rel = "noopener noreferrer nofollow";

  return (
    <article>
      <p className="text-sm">
        <Link href="/" className="underline">Browse</Link> / <span aria-current="page">{listing.title}</span>
      </p>
      <h1 className="mt-3 text-3xl font-bold">{listing.title}</h1>
      <p className="mt-3 max-w-3xl">{listing.summary}</p>

      <div className="mt-6 max-w-3xl">
        <EvidenceNote listing={listing} />
      </div>

      <h2 className="mt-8 text-xl font-semibold">Facts</h2>
      <p className="text-sm text-[color:var(--muted)]">Values marked “as declared” were published by the project itself and were not tested by this directory.</p>
      <dl className="mt-2 max-w-3xl divide-y divide-[color:var(--line)]">
        {f.repoUrl ? (
          <Row label="Repository">
            <a className={external} rel={rel} target="_blank" href={f.repoUrl}>{f.repoName ? `${f.repoName} (${hostOf(f.repoUrl)})` : hostOf(f.repoUrl)}</a>
            {f.archived ? " (archived)" : ""}
            {f.fork ? " (fork)" : ""}
          </Row>
        ) : null}
        {f.homepage ? (
          <Row label="Homepage (as declared)">
            <a className={external} rel={rel} target="_blank" href={f.homepage}>{hostOf(f.homepage)}</a>
          </Row>
        ) : null}
        {f.repoLicence ? <Row label="Licence (repository metadata)">{f.repoLicence}</Row> : null}
        {f.licence && f.licence !== f.repoLicence ? <Row label="Licence (as declared)">{f.licence}</Row> : null}
        {f.repoPushedAt ? <Row label="Repository last updated">{formatDate(f.repoPushedAt)}</Row> : null}
        {f.transports.length ? <Row label="Transports (as declared)">{f.transports.join(", ")}</Row> : null}
        {f.hosting ? <Row label="Hosting (as declared)">{f.hosting}</Row> : null}
        {f.packageIds.length ? <Row label="Packages (as declared)">{f.packageIds.join(", ")}</Row> : null}
        {f.endpoints.length ? <Row label="Endpoints (as declared)">{f.endpoints.join(", ")}</Row> : null}
        {f.installCommand ? (
          <Row label="Install command (as declared)">
            <code className="break-all rounded bg-[color:var(--panel)] px-1">{f.installCommand}</code>
            <span className="mt-1 block text-[color:var(--muted)]">Shown as text only. Read the project&apos;s own documentation before running anything.</span>
          </Row>
        ) : null}
        <Row label="Last checked">{formatDate(listing.evidenceCheckedAt)}</Row>
      </dl>

      {listing.sourceLinks.length ? (
        <>
          <h2 className="mt-8 text-xl font-semibold">Sources</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {listing.sourceLinks.map((s) => (
              <li key={s.url}>
                <a className={external} rel={rel} target="_blank" href={s.url}>{hostOf(s.url)}</a> ({s.kind}
                {s.retrievedAt ? `, retrieved ${formatDate(s.retrievedAt)}` : ""})
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-10 text-sm">
        Something wrong, or you maintain this project and want it changed or removed?{" "}
        <Link className="underline" href={`/removal?entry=${encodeURIComponent(listing.slug)}`}>Removal and corrections</Link>.
      </p>
    </article>
  );
}
