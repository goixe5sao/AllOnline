import type { Metadata } from "next";
import { connection } from "next/server";
import { MAP_INFO } from "@/core/maps";
import { getInviteMeta } from "@/lib/home-data";
import { vnEventTime } from "@/lib/vn-time";

/**
 * Server-rendered title / description for an invite link, so a link pasted into Zalo, Facebook
 * or Messenger shows the event name, time and its own share image (opengraph-image.tsx).
 * Rooms not shown on the home page are kept out of search engines (noindex).
 */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  await connection();
  const { code } = await params;
  const m = await getInviteMeta(code);
  if (!m) return { title: "Link mời", robots: { index: false, follow: false } };
  const when = m.startsAt ? vnEventTime(m.startsAt) : null;
  const title = when ? `${m.name} — ${when}` : m.name;
  const description =
    (m.description ? m.description.slice(0, 160) + " · " : "") +
    `${MAP_INFO[m.map].name} 3D trên AllOnline${m.ownerName ? `, tổ chức bởi ${m.ownerName}` : ""}. Vào bằng trình duyệt, không cần cài đặt.`;
  return {
    title,
    description,
    alternates: { canonical: `/join/${code}` },
    robots: m.isPublic ? undefined : { index: false, follow: false },
    openGraph: { title, description, type: "website", url: `/join/${code}`, locale: "vi_VN", siteName: "AllOnline" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
