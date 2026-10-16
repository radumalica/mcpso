import type { Metadata } from "next";
import Link from "next/link";
import { EVIDENCE_LABEL, EVIDENCE_WORDING, type EvidenceLevel } from "@/lib/evidence";
import { NON_AFFILIATION } from "@/lib/site";

export const metadata: Metadata = { title: "How entries are chosen" };

const LEVELS: EvidenceLevel[] = [2, 1, 0];

export default function About() {
  return (
    <div className="prose-page max-w-3xl">
      <h1 className="text-3xl font-bold">How entries are chosen</h1>
      <p>{NON_AFFILIATION}</p>

      <h2>What this directory is</h2>
      <p>
        A directory of Model Context Protocol servers. It lists projects that have been matched to a public identity (a repository, a
        package or an endpoint), checked against written criteria, and approved by a person. Being listed means a project met the
        criteria for inclusion. It does not mean the project works, is maintained, or is safe to run.
      </p>

      <h2>Where entries come from</h2>
      <ul>
        <li>Public requests to add servers to a community list, collected from the public record and de-duplicated by identity.</li>
        <li>Public facts read from the project&apos;s own repository (existence, licence, last activity, whether it is archived).</li>
        <li>The official MCP Registry, used only as a reference to compare against, never as proof of correctness.</li>
      </ul>
      <p>Nothing from these sources is executed, installed or built. Summaries on this site are written for this directory, not copied from the projects.</p>

      <h2>What was checked: evidence levels</h2>
      <p>Every entry states one of three levels and the date. These are the exact statements shown on entries:</p>
      <ul>
        {LEVELS.map((l) => (
          <li key={l}>
            <strong>{EVIDENCE_LABEL[l]}.</strong> {EVIDENCE_WORDING[l].replace("{date}", "<date>")}
          </li>
        ))}
      </ul>
      <p>Entries that are declared only are hidden from the default view and are not offered to search engines.</p>

      <h2>What is never done</h2>
      <ul>
        <li>No entry is called verified, trusted, recommended or secure, and there are no ratings.</li>
        <li>Popularity, stars and the length of a README are not treated as evidence.</li>
        <li>Nothing is published automatically. Each entry is approved by a person, and entries with an unresolved security concern, removal request, rights question or identity doubt are held back.</li>
      </ul>

      <h2>Corrections and removal</h2>
      <p>
        If you maintain a listed project, you can ask for a correction or for removal. See <Link href="/removal">Removal and corrections</Link>.
        A removal is permanent for that project unless the maintainer asks to be listed again.
      </p>
    </div>
  );
}
