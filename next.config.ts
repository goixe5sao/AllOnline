import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A test build can go elsewhere (NEXT_DIST_DIR=.next-test) without touching the live .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
