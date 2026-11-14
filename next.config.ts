import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone and camera are needed for answers and on-device video analysis; everything else is off.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(self), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite"],
  // Face tracking runs only in the browser. Its package points bundlers at a Node.js build that
  // needs native TensorFlow, so always use the browser build instead.
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, "@vladmandic/human$": path.join(process.cwd(), "node_modules/@vladmandic/human/dist/human.esm.js") };
    return config;
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
