import { describe, expect, it } from "vitest";
import { resolveBackendRewriteDestination } from "../../next.config";

describe("Next.js Backend Rewrite Destination Resolution", () => {
  it("prepends https:// to Render host values lacking URL scheme", () => {
    const destination = resolveBackendRewriteDestination("waybound-backend.onrender.com");
    expect(destination).toBe("https://waybound-backend.onrender.com/api/v1/:path*");
  });

  it("preserves explicitly provided https:// schemes", () => {
    const destination = resolveBackendRewriteDestination("https://api.waybound.dev");
    expect(destination).toBe("https://api.waybound.dev/api/v1/:path*");
  });

  it("strips trailing slashes cleanly before appending path pattern", () => {
    const destination = resolveBackendRewriteDestination("https://waybound-backend.onrender.com///");
    expect(destination).toBe("https://waybound-backend.onrender.com/api/v1/:path*");
  });

  it("handles localhost and local loopback development endpoints with http://", () => {
    expect(resolveBackendRewriteDestination("http://localhost:8000")).toBe(
      "http://localhost:8000/api/v1/:path*"
    );
    expect(resolveBackendRewriteDestination("localhost:8000")).toBe(
      "http://localhost:8000/api/v1/:path*"
    );
    expect(resolveBackendRewriteDestination("127.0.0.1:8000")).toBe(
      "http://127.0.0.1:8000/api/v1/:path*"
    );
  });

  it("falls back to default http://localhost:8000 for empty or whitespace inputs", () => {
    expect(resolveBackendRewriteDestination("")).toBe(
      "http://localhost:8000/api/v1/:path*"
    );
    expect(resolveBackendRewriteDestination("   ")).toBe(
      "http://localhost:8000/api/v1/:path*"
    );
  });

  it("handles subpaths correctly", () => {
    const destination = resolveBackendRewriteDestination("https://api.waybound.dev/internal");
    expect(destination).toBe("https://api.waybound.dev/internal/api/v1/:path*");
  });
});
