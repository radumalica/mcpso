import { findProjectByName, getRandomProjects } from "@/models/project";

// Database-backed: rendered per request, never prerendered at build time.
export const dynamic = "force-dynamic";

import Single from "@/templates/tailspark/landing/pages/single";
import { findCategoryByName } from "@/models/category";
import pagejson from "@/pagejson/en.json";


export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const project = await findProjectByName(name);

  return {
    title: `${project?.title || "-"} | ${pagejson?.metadata?.title}`,
    description: `Find Awesome MCP Server ${project?.title || "-"}: ${
      project?.description || "-"
    }`,
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_WEB_URL}/server/${name}`,
    },
  };
}

export default async function ({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;

  const project = await findProjectByName(name);
  if (!project || !project.uuid) {
    return <div>Project not found</div>;
  }

  const category = await findCategoryByName(project.category || "");

  const more_projects = await getRandomProjects(1, 50);

  return (
    <Single
      project={project}
      more_projects={more_projects}
      category={category}
    />
  );
}
