import { NextRequest, NextResponse } from "next/server";
import * as bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireVendorPermission } from "@/lib/vendor-guard";

// ──────────────────────────────────────────────────────────
// POST /api/vendor/users/[id]/reset-password
// Generates a random 16-char temp password, saves the hash,
// and returns the plaintext to the admin (shown in a dialog).
// ──────────────────────────────────────────────────────────
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireVendorPermission("v_users", "edit");
    if (!auth.success) return auth.response;

    const { id } = await params;

    // Cannot reset own password via this admin endpoint
    if (auth.session.isStaff && auth.session.userId === id) {
      return NextResponse.json(
        { error: "You cannot reset your own password here. Use the forgot-password flow." },
        { status: 403 }
      );
    }

    // Verify user belongs to this vendor
    const target = await db.vendorUser.findFirst({
      where: { id, vendorId: auth.vendorId },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Generate random 16-char password
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*";
    const newPassword = Array.from({ length: 16 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");

    const passwordHash = bcrypt.hashSync(newPassword, 10);

    await db.vendorUser.update({
      where: { id },
      data: { passwordHash },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        userName: auth.session.name,
        vendorId: auth.vendorId,
        action: "vendor.user.reset_password",
        entityType: "VendorUser",
        entityId: id,
        metadata: { targetName: target.name, targetEmail: target.email },
      },
    }).catch((err: unknown) => {
      console.warn("[vendor audit] failed to write audit log:", err);
    });

    return NextResponse.json({ success: true, password: newPassword });
  } catch (error) {
    console.error("[/api/vendor/users/[id]/reset-password POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
