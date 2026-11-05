import type { Metadata, Viewport } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_SHORT, SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_SHORT}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_SHORT,
  keywords: ["sân khấu 3D", "phòng 3D trực tuyến", "hội trường online", "rạp chiếu online", "xem chung màn hình", "sự kiện trực tuyến", "bình chọn trực tiếp", "AllOnline"],
  openGraph: { type: "website", locale: "vi_VN", siteName: SITE_SHORT, title: SITE_NAME, description: SITE_DESCRIPTION, url: "/", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Sân khấu 3D của tương lai — AllOnline" }] },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION, images: ["/og.png"] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#05060f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
