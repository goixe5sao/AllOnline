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
  // Zalo for Developers asks to verify the domain (webhook / login redirect) with this meta tag.
  ...(process.env.ZALO_SITE_VERIFICATION ? { other: { "zalo-platform-site-verification": process.env.ZALO_SITE_VERIFICATION } } : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f1fc" },
    { media: "(prefers-color-scheme: dark)", color: "#05060f" },
  ],
};

// Runs before first paint: the visitor's saved theme, otherwise dark (the stage look).
const THEME_SCRIPT = `(function(){var t="dark";try{var s=localStorage.getItem("ao-theme");if(s==="light"||s==="dark")t=s}catch(e){}var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
