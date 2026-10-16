import Categories from "@/templates/tailspark/landing/components/categories";
import { getCategories } from "@/models/category";
import { getFeaturedProjects } from "@/models/project";
import pageJson from "@/pagejson/en.json";

// Database-backed: rendered per request, never prerendered at build time.
export const dynamic = "force-dynamic";


export async function generateMetadata() {
  return {
    title: `MCP Server Categories | ${pageJson?.metadata?.title}`,
    description: `Find Awesome MCP Server categories for your needs`,
    alternates: {
      canonical: `${process.env.NEXT_PUBLIC_WEB_URL}/categories`,
    },
  };
}

export default async function () {
  const categories = await getCategories(1, 100);
  const projects = await getFeaturedProjects(1, 60);

  return <Categories categories={categories} projects={projects} />;
}
