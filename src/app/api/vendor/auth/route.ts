import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { createVendorToken, createVendorUserToken } from "@/lib/vendor-auth";
import {
  checkRateLimit,
  clientIpFromHeaders,
  isRateLimited,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    // FIX-1a: brute-force throttle — 10 FAILED attempts / 15 min per
    // identifier + IP. Only failures are counted.
    const failKey = `login-fail:vendor:${clientIpFromHeaders(req.headers)}:${String(email).toLowerCase()}`;
    if (isRateLimited(failKey, RATE_LIMITS.loginFailures.limit)) {
      return NextResponse.json(rateLimitResponsePayload(failKey), { status: 429 });
    }
    const recordFailure = () =>
      checkRateLimit(
        failKey,
        RATE_LIMITS.loginFailures.limit,
        RATE_LIMITS.loginFailures.windowMs
      );

    // ── 1. Try the Vendor (owner) table first — backward compatible for
    //       demo vendors created by Ops (e.g. ops@sparkclean.sg). ──
    const vendor = await db.vendor.findUnique({ where: { email } });

    if (vendor) {
      if (vendor.status !== "ACTIVE") {
        return NextResponse.json(
          { error: `Account is ${vendor.status.toLowerCase()}. Contact ops for assistance.` },
          { status: 403 }
        );
      }

      // Self-heal: if passwordHash is null (schema push wiped it), hash the
      // incoming password and persist it. Needed for Railway recovery.
      // ── P2 (AUDIT-4): DEV/CI ONLY. In production a NULL passwordHash
      // means the account has no self-serve login — the self-heal would
      // let ANY password take over the account. Production denies. ──
      let passwordHash = vendor.passwordHash;
      if (!passwordHash) {
        if (IS_PRODUCTION) {
          console.error(
            `[vendor/auth] Blocked login for NULL-passwordHash account ${email} in production`
          );
          return NextResponse.json(
            { error: "Invalid credentials" },
            { status: 401 }
          );
        }
        console.warn(`[vendor/auth] passwordHash is NULL for ${email} — auto-setting from login attempt (dev/CI self-heal)`);
        passwordHash = bcrypt.hashSync(password, 10);
        await db.vendor.update({
          where: { id: vendor.id },
          data: { passwordHash },
        });
      }

      const valid = await bcrypt.compare(password, passwordHash);
      if (!valid) {
        recordFailure();
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 }
        );
      }

      const token = await createVendorToken({
        id: vendor.id,
        email: vendor.email,
        name: vendor.name,
        vendorType: vendor.vendorType,
        status: vendor.status,
      });

      const res = NextResponse.json({
        success: true,
        token,
        vendor: {
          id: vendor.id,
          name: vendor.name,
          email: vendor.email,
          vendorType: vendor.vendorType,
          status: vendor.status,
        },
      });

      res.cookies.set("vendor_token", token, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: "lax",
        path: "/",
        maxAge: 24 * 3600,
      });

      return res;
    }

    // ── 2. Fall back to VendorUser (HQ staff) — finance, auditors, analysts,
    //       operations managers created via User Management. These are NOT
    //       field roster members (Staff Roster) and never authenticate here
    //       against VendorStaff. ──
    const staffUser = await db.vendorUser.findUnique({
      where: { email },
      include: { vendor: { select: { id: true, vendorType: true, status: true } } },
    });

    if (staffUser) {
      if (!staffUser.isActive) {
        return NextResponse.json(
          { error: "Account is suspended. Contact your vendor administrator." },
          { status: 403 }
        );
      }

      // Parent vendor must be ACTIVE for the staff user to log in.
      if (staffUser.vendor.status !== "ACTIVE") {
        return NextResponse.json(
          { error: `Vendor account is ${staffUser.vendor.status.toLowerCase()}. Contact ops for assistance.` },
          { status: 403 }
        );
      }

      const valid = await bcrypt.compare(password, staffUser.passwordHash);
      if (!valid) {
        recordFailure();
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 }
        );
      }

      const token = await createVendorUserToken({
        userId: staffUser.id,
        vendorId: staffUser.vendorId,
        email: staffUser.email,
        name: staffUser.name,
        vendorType: staffUser.vendor.vendorType,
        status: "ACTIVE",
      });

      const res = NextResponse.json({
        success: true,
        token,
        vendor: {
          id: staffUser.vendorId,
          name: staffUser.name,
          email: staffUser.email,
          vendorType: staffUser.vendor.vendorType,
          status: "ACTIVE",
        },
      });

      res.cookies.set("vendor_token", token, {
        httpOnly: true,
        secure: IS_PRODUCTION,
        sameSite: "lax",
        path: "/",
        maxAge: 24 * 3600,
      });

      return res;
    }

    // No match in either table.
    recordFailure();
    return NextResponse.json(
      { error: "Invalid credentials" },
      { status: 401 }
    );
  } catch (error) {
    console.error("[/api/vendor/auth POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // ── P7 (AUDIT-4): clear the vendor_token cookie on logout.
    //
    // Previously this endpoint deliberately left the 24h cookie in place,
    // relying on the logging-out tab clearing only its own sessionStorage.
    // That left a fully valid session cookie on the device after logout —
    // anyone with device access (or an XSS read of document.cookie
    // exfiltration path) could keep acting as the vendor for up to 24h.
    //
    // Multi-tab impact: other open tabs keep working for API calls that use
    // their per-tab Authorization header (getVendorSession checks the
    // header first), but page loads through the middleware now correctly
    // redirect to /vendor/login — which is the expected post-logout
    // behavior. Security beats multi-tab convenience.
    const res = NextResponse.json({ success: true });
    res.cookies.set("vendor_token", "", {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (error) {
    console.error("[/api/vendor/auth DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
