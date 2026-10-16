import type { Metadata } from "next";
import { SLUG_RE } from "@/lib/listing";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Removal and corrections", robots: { index: false, follow: true } };

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

export default async function Removal({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.entry) ? sp.entry[0] : sp.entry;
  const entry = typeof raw === "string" && SLUG_RE.test(raw) ? raw : null; // only a valid slug is ever echoed back
  const subject = encodeURIComponent(entry ? `Removal or correction: ${entry}` : "Removal or correction request");

  return (
    <div className="prose-page max-w-3xl">
      <h1 className="text-3xl font-bold">Removal and corrections</h1>
      <p>
        You can ask for an entry to be corrected or removed, and you can report a security concern or a rights complaint about an entry.
        {entry ? <> This request concerns the entry <code>{entry}</code>.</> : null}
      </p>

      <h2>How to ask</h2>
      {site.contactEmail ? (
        <p>
          Email <a href={`mailto:${site.contactEmail}?subject=${subject}`}>{site.contactEmail}</a>. Include the address of the entry (or
          the project&apos;s repository, package or endpoint) and what you want changed.
        </p>
      ) : (
        <p role="alert">This directory has no contact address configured yet, so requests cannot be received. It must be set before launch.</p>
      )}

      <h2>What happens next</h2>
      <ol>
        <li>The project named in the request is put on hold straight away: nothing about it can be approved or newly published while the request is open.</li>
        <li>We check that the request comes from someone who controls the project, for example with write access to its repository.</li>
        <li>A person decides and records the reason. A removal also stops the project from being added again by a later import.</li>
      </ol>

      <h2>What we do not publish</h2>
      <p>
        Requesters&apos; names and contact details are kept private and are not shown on entries. Entries show facts about projects, not about the people who asked for them to be listed.
      </p>
    </div>
  );
}
