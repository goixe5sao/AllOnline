import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "AllOnline — Không gian kết nối", description: "Không gian 3D nhiều phòng cho cộng đồng AllOnline" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="vi"><body>{children}</body></html>; }
