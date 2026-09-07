import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { resolveSecret } from "@/lib/secrets";

// Lazy, memoized secret resolution: the secrets below are resolved on
// first USE (request time), not at module import, so `next build` and
// cold module evaluation never require deployment secrets.
function opsSecretKey(): Uint8Array {
  return new TextEncoder().encode(
    resolveSecret("OPS_JWT_SECRET", "anna-ops-dev-secret", {
      owner: "middleware (ops JWT)",
    })
  );
}
function vendorSecretKey(): Uint8Array {
  return new TextEncoder().encode(
    resolveSecret("VENDOR_JWT_SECRET", "anna-vendor-dev-secret", {
      owner: "middleware (vendor JWT)",
    })
  );
}
// NOTE: the household_token cookie is intentionally NOT verified here —
// the client LayoutShell handles session redirect (see the "/" branch
// below). If that changes, resolve the secret lazily like the helpers
// above so module evaluation stays build-safe.

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Ops routes ──
  if (pathname.startsWith("/ops")) {
    if (pathname === "/ops/login") {
      return NextResponse.next();
    }

    const token = req.cookies.get("ops_token")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/ops/login", req.url));
    }

    try {
      await jwtVerify(token, opsSecretKey());
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL("/ops/login", req.url));
    }
  }

  // ── Vendor routes ──
  if (pathname.startsWith("/vendor")) {
    if (pathname === "/vendor/login") {
      return NextResponse.next();
    }

    const token = req.cookies.get("vendor_token")?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/vendor/login", req.url));
    }

    try {
      await jwtVerify(token, vendorSecretKey());
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL("/vendor/login", req.url));
    }
  }

  // ── Protected household routes (require household_token) ──
  // Only protect "/" (main app) — login, register, auth API, billing API, static assets are public
  if (pathname === "/") {
    // Skip if no household_token — let the client-side LayoutShell handle redirect
    // This avoids middleware blocking the login page after Google OAuth bridge
    const token = req.cookies.get("household_token")?.value;
    if (!token) {
      // Don't redirect here — let the client handle it via session check
      // This is needed so NextAuth callback flow works without circular redirects
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/ops",
    "/ops/:path((?!login).*)",
    "/vendor",
    "/vendor/:path((?!login).*)",
  ],
};
