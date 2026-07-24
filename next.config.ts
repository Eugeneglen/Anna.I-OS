import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "*.space-z.ai",
    "space-z.ai",
    "localhost",
  ],
  // Rewrite legacy upload paths to the serve API route.
  // Existing DB records store URLs like /attachments/... and /avatars/...
  // These rewrites route them through /api/serve/... so uploaded files
  // are served correctly in production (including Railway) without relying
  // on Next.js static file serving from the public directory.
  async rewrites() {
    return [
      {
        source: "/attachments/:path*",
        destination: "/api/serve/attachments/:path*",
      },
      {
        source: "/avatars/:path*",
        destination: "/api/serve/avatars/:path*",
      },
    ];
  },
};

export default nextConfig;
