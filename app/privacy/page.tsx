import type { Metadata } from "next";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy", robots: { index: false, follow: true } };

export default function Privacy() {
  return (
    <div className="prose-page max-w-3xl">
      <h1 className="text-3xl font-bold">Privacy</h1>
      <p role="note" className="rounded border border-[color:var(--line)] bg-[color:var(--panel)] p-3 text-sm">
        Draft for legal review. It describes what the software does today; it is not legal advice and must be reviewed by counsel before launch.
      </p>

      <h2>What this site collects</h2>
      <ul>
        <li>No accounts, no cookies set by the site, no analytics, no advertising and no third-party scripts.</li>
        <li>Search terms are sent to the server to produce results. They are not stored by the application.</li>
        <li>The hosting provider may keep standard request logs (address, time, page). The provider and retention period must be stated here before launch.</li>
      </ul>

      <h2>What the directory holds about other people</h2>
      <p>
        Entries describe software projects using public information about the project. The directory&apos;s source data may include the
        public GitHub handle of the person who asked for a server to be listed; this is kept internally for attribution and removal
        handling and is not shown on entries.
      </p>

      <h2>Your rights</h2>
      <p>
        To ask what is held about you, or to have it corrected or deleted, use{" "}
        {site.contactEmail ? <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a> : "the contact address (not yet configured)"}.
      </p>
    </div>
  );
}
