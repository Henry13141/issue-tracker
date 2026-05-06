import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  allowedDevOrigins: ["192.168.31.115"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },
};

export default nextConfig;
