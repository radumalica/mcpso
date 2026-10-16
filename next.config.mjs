import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";

// Baseline response headers (master plan v5, A6). A Content-Security-Policy needs per-request nonces for the
// inline scripts Next.js emits and is added separately once the hosting target (D2) is fixed.
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

if (process.env.NODE_ENV === "development") {
  // await setupDevPlatform();
}

export default nextConfig;
