import {
  getFeaturedProjects,
  getProjectsCount,
  getProjectsWithKeyword,
} from "@/models/project";

// Database-backed: rendered per request, never prerendered at build time.
export const dynamic = "force-dynamic";

import LandingPage from "@/templates/tailspark/landing/pages/index";
import { Project } from "@/types/project";
import pagejson from "@/pagejson/en.json";


export default async function ({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { q } = await searchParams;
  let projects: Project[] = [];

  if (q) {
    projects = await getProjectsWithKeyword(q as string, 1, 100);
  } else {
    projects = await getFeaturedProjects(1, 100);
  }

  const projectsCount = await getProjectsCount();

  return (
    <LandingPage
      page={pagejson}
      projects={projects}
      projectsCount={projectsCount}
    />
  );
}
