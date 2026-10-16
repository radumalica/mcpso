import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic"; // the sitemap URL comes from the runtime SITE_URL

export default function robots(): MetadataRoute.Robots {
  return {
    // Search result pages and request forms are not for indexing; entries and the catalogue are.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/*?*q=", "/*?*declared=", "/*?*page=", "/removal", "/privacy", "/terms"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
