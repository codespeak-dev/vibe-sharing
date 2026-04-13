import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["codespeak-vibe-share"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
