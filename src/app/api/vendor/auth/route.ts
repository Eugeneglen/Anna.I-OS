import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { createVendorToken, createVendorUserToken } from "@/lib/vendor-auth";

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
      let passwordHash = vendor.passwordHash;
      if (!passwordHash) {
        console.warn(`[vendor/auth] passwordHash is NULL for ${email} — auto-setting from login attempt`);
        passwordHash = bcrypt.hashSync(password, 10);
        await db.vendor.update({
          where: { id: vendor.id },
          data: { passwordHash },
        });
      }

      const valid = await bcrypt.compare(password, passwordHash);
      if (!valid) {
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
    // NOTE: We do NOT clear the vendor_token cookie here.
    // With multi-tab support, each tab stores its own JWT in sessionStorage.
    // Clearing the shared cookie would break other tabs' middleware access.
    // The cookie expires naturally in 24h. The logging-out tab clears its
    // own sessionStorage client-side, which is sufficient.
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/vendor/auth DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
