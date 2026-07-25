import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const OPS_JWT_SECRET = process.env.OPS_JWT_SECRET || "anna-ops-dev-secret";
const VENDOR_JWT_SECRET = process.env.VENDOR_JWT_SECRET || "anna-vendor-dev-secret";
const HOUSEHOLD_JWT_SECRET = process.env.HOUSEHOLD_JWT_SECRET || "anna-household-dev-secret";
const opsSecret = new TextEncoder().encode(OPS_JWT_SECRET);
const vendorSecret = new TextEncoder().encode(VENDOR_JWT_SECRET);
const householdSecret = new TextEncoder().encode(HOUSEHOLD_JWT_SECRET);

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
      await jwtVerify(token, opsSecret);
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
      await jwtVerify(token, vendorSecret);
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
