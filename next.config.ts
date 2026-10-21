import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep deployment-target agnostic: nothing here should assume Vercel.
  // Moving to AWS Amplify / ECS later should require no code change.
  images: {
    // Off Vercel (Cloudflare) photos are served as they are, not through
    // Cloudflare Images (free up to 5,000 a month, then new sizes fail).
    unoptimized: !process.env.VERCEL,
    remotePatterns: [
      // Supabase Storage public buckets. Host comes from env, never hardcoded.
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? [
            {
              protocol: "https" as const,
              hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
            },
          ]
        : []),
    ],
  },
  // Local development runs on admin.localhost:3000 and owner.localhost:3000.
  // Without this, `next dev` refuses dev-only resources (HMR, overlays) to
  // any origin other than plain localhost.
  allowedDevOrigins: ["admin.localhost", "owner.localhost", "*.localhost"],
  experimental: {
    // Document uploads go through a server action and may be up to 25 MB
    // (the documents bucket's limit); the form itself adds a little.
    serverActions: { bodySizeLimit: "26mb" },
    // The proxy (src/proxy.ts) buffers request bodies too, by default only
    // the first 10 MB, which would cut a larger upload short.
    proxyClientMaxBodySize: "26mb",
  },
  // Security headers for every response. On Vercel, vercel.json sets them.
  async headers() {
    if (process.env.VERCEL) return [];
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
