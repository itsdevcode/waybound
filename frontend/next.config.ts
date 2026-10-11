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

  // If no scheme is present (e.g. Render fromService host "waybound-backend.onrender.com"),
  // prepend http:// for localhost/loopback and https:// for all remote hosts.
  if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) {
    const isLocal =
      candidate.startsWith("localhost") ||
      candidate.startsWith("127.0.0.1") ||
      candidate.startsWith("0.0.0.0") ||
      candidate.startsWith("[::1]");
    candidate = isLocal ? `http://${candidate}` : `https://${candidate}`;
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
