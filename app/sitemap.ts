import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { listSitemapEntries } from "@/models/listing";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = [{ url: absoluteUrl("/") }, { url: absoluteUrl("/about") }];
  try {
    const entries = await listSitemapEntries();
    return [...pages, ...entries.map((e) => ({ url: absoluteUrl(`/s/${e.slug}`), lastModified: e.publishedAt ?? undefined }))];
  } catch {
    return pages; // a data outage must not turn the sitemap into an error; entries return when the data does
  }
}
