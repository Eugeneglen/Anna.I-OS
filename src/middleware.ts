import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = process.env.OPS_JWT_SECRET || "anna-ops-dev-secret";
const secret = new TextEncoder().encode(JWT_SECRET);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect /ops/* page routes (not API routes — those self-authenticate)
  if (!pathname.startsWith("/ops") || pathname === "/ops/login") {
    return NextResponse.next();
  }

  const token = req.cookies.get("ops_token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/ops/login", req.url));
  }

  try {
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/ops/login", req.url));
  }
}

export const config = {
  matcher: ["/ops/:path((?!login).*)"],
};