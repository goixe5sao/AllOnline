import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AllOnline — Không gian 3D nhiều phòng",
  description: "Phòng 3D: hội trường, thảm ngồi, khu bàn và rạp chiếu ngoài trời. Màn hình chung, chat gần và bình chọn.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
