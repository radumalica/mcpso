import { siteProblems } from "@/lib/site";

export const dynamic = "force-dynamic";

/** Read-only configuration check for deploys and monitors. Reports problem names only, never values. */
export function GET(): Response {
  const problems = siteProblems();
  return Response.json({ ok: problems.length === 0, problems }, { status: problems.length ? 503 : 200, headers: { "cache-control": "no-store" } });
}
