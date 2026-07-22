import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker image
  // can ship just `server.js` + a pruned node_modules instead of the whole repo.
  output: "standalone",
};

export default nextConfig;
