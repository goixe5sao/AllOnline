import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { SITE_URL } from "@/lib/site";

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection(); // use the runtime PUBLIC_ORIGIN, not the one present at build time
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/room/", "/orders", "/rooms/new"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
