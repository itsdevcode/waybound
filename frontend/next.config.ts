import type { NextConfig } from "next";

export function resolveBackendRewriteDestination(rawUrl?: string): string {
  const raw = (
    rawUrl ??
    process.env.BACKEND_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000"
  ).trim();

  let candidate = raw.replace(/\/+$/, "");
  if (!candidate) {
    return "http://localhost:8000/api/v1/:path*";
  }

  // If no scheme is present (e.g. Render host "waybound-backend.onrender.com" or internal "waybound-backend:10000"),
  // prepend http:// for localhost/loopback/internal service hostports and https:// for public remote hosts.
  if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) {
    const hostname = candidate.split("/")[0].split(":")[0];
    const isLocalOrInternal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "[::1]" ||
      !hostname.includes(".");
    candidate = isLocalOrInternal ? `http://${candidate}` : `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}/api/v1/:path*`;
  } catch {
    return "http://localhost:8000/api/v1/:path*";
  }
}

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: resolveBackendRewriteDestination(),
      },
    ];
  },
};

export default nextConfig;
