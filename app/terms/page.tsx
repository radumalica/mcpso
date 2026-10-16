import type { Metadata } from "next";
import { NON_AFFILIATION, site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms", robots: { index: false, follow: true } };

export default function Terms() {
  return (
    <div className="prose-page max-w-3xl">
      <h1 className="text-3xl font-bold">Terms</h1>
      <p role="note" className="rounded border border-[color:var(--line)] bg-[color:var(--panel)] p-3 text-sm">
        Draft for legal review. It is not legal advice and must be reviewed by counsel before launch.
      </p>

      <h2>Information only</h2>
      <p>
        {site.name} is an information service. Entries are provided as is, without warranty. An entry is not an endorsement, a review of
        the software, or a statement that it is safe, correct or fit for any purpose. You decide whether to use any software listed here
        and you are responsible for checking it first.
      </p>

      <h2>Third-party software and names</h2>
      <p>{NON_AFFILIATION}</p>

      <h2>Corrections and removal</h2>
      <p>Requests are handled as described on the removal and corrections page.</p>

      <h2>Source code</h2>
      <p>The software that runs this site is open source under the Apache License 2.0; see the NOTICE file in its repository for attribution.</p>
    </div>
  );
}
