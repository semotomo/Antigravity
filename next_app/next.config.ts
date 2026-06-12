import type { NextConfig } from "next";

const nextConfig: any = {
  allowedDevOrigins: ['192.168.1.89'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
