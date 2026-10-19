import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/gurumi/scores": ["./public/assets/ausgcon/gurumi/reference.png"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
