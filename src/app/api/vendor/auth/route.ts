import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { createVendorToken } from "@/lib/vendor-auth";

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

    const vendor = await db.vendor.findUnique({ where: { email } });

    if (!vendor) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    if (vendor.status !== "ACTIVE") {
      return NextResponse.json(
        { error: `Account is ${vendor.status.toLowerCase()}. Contact ops for assistance.` },
        { status: 403 }
      );
    }

    // ── Self-heal: if passwordHash is null (new column from schema push),
    //    hash the incoming password and persist it. This handles the case
    //    where ensure-seed.ts backfill didn't reach the database.       ──
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
  } catch (error) {
    console.error("[/api/vendor/auth POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
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
