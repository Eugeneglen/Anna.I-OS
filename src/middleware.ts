import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const OPS_JWT_SECRET = process.env.OPS_JWT_SECRET || "anna-ops-dev-secret";
const VENDOR_JWT_SECRET = process.env.VENDOR_JWT_SECRET || "anna-vendor-dev-secret";
const opsSecret = new TextEncoder().encode(OPS_JWT_SECRET);
const vendorSecret = new TextEncoder().encode(VENDOR_JWT_SECRET);

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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/ops",
    "/ops/:path((?!login).*)",
    "/vendor",
    "/vendor/:path((?!login).*)",
  ],
};
