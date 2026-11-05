import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getHomeData } from "@/lib/home-data";
import { SITE_URL } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection(); // public rooms change all the time → build per request
  const { rooms } = await getHomeData();
  return [
    { url: `${SITE_URL}/`, lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/login`, changeFrequency: "yearly", priority: 0.3 },
    // Public rooms (their owners chose to list them): the join page of each.
    ...rooms.map((r) => ({ url: `${SITE_URL}/join/${r.inviteCode}`, changeFrequency: "hourly" as const, priority: 0.6 })),
  ];
}
