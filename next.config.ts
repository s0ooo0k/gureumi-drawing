import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/gurumi/scores": ["./public/assets/ausgcon/gurumi/reference.png", "./public/assets/krug/*.png"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
