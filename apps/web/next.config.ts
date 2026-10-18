import os from "node:os";
import type { NextConfig } from "next";

const devHost = process.env.TELAR_WEB_HOST?.trim();
const extraOrigins = (process.env.TELAR_WEB_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const wildcardBind = devHost === "0.0.0.0" || devHost === "::";
const interfaceAddresses = wildcardBind
  ? Object.values(os.networkInterfaces())
      .flat()
      .flatMap((entry) => (entry && !entry.internal ? [entry.address] : []))
  : [];
const allowedDevOrigins = [
  ...(devHost && devHost !== "127.0.0.1" && devHost !== "localhost" && !wildcardBind ? [devHost] : []),
  ...interfaceAddresses,
  ...extraOrigins,
];
if (allowedDevOrigins.length > 0) {
  for (const loopback of ["127.0.0.1", "localhost"]) {
    if (!allowedDevOrigins.includes(loopback)) allowedDevOrigins.push(loopback);
  }
}

const devEngine = process.env.TELAR_DEV_ENGINE_URL?.trim();

const nextConfig: NextConfig = {
  transpilePackages: ["@telar/engine-client"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: process.env.NEXT_OUTPUT === "export" ? "export" : undefined,
  ...(process.env.NEXT_OUTPUT === "export" ? { images: { unoptimized: true }, trailingSlash: false } : {}),
  devIndicators: { position: "bottom-right" },
  ...(devEngine ? { rewrites: async () => [{ source: "/v2/:path*", destination: `${devEngine}/v2/:path*` }] } : {}),
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
