import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic"; // the sitemap URL comes from the runtime SITE_URL

export default function robots(): MetadataRoute.Robots {
  return {
    // Only search and filter URLs are blocked from crawling. Other pages that carry a noindex tag stay crawlable so the tag can be seen.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/*?*q=", "/*?*declared="] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
