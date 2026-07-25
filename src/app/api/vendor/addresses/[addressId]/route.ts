import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";

// ============================================================
// Vendor Single Address
// DELETE /api/vendor/addresses/[addressId]  — delete address
// ============================================================

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ addressId: string }> }
) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { addressId } = await params;

    // Verify address belongs to this vendor
    const address = await db.address.findUnique({
      where: { id: addressId },
    });

    if (!address || address.vendorId !== session.vendorId) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }

    // Prevent deleting the last address
    const count = await db.address.count({
      where: {
        ownerType: "VENDOR",
        vendorId: session.vendorId,
      },
    });

    if (count <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last address. Add another one first." },
        { status: 400 }
      );
    }

    await db.address.delete({ where: { id: addressId } });

    // If deleted address was default, promote the oldest remaining
    if (address.isDefault) {
      const nextDefault = await db.address.findFirst({
        where: { ownerType: "VENDOR", vendorId: session.vendorId },
        orderBy: { createdAt: "asc" },
      });
      if (nextDefault) {
        await db.address.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[vendor addresses DELETE] error:", error);
    return NextResponse.json({ error: "Failed to delete address" }, { status: 500 });
  }
}
