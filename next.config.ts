import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["node-cron"],
  devIndicators: false,
};

export default nextConfig;
