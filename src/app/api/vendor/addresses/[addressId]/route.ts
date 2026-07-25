import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";
import { buildFullAddress, getRequiredFields } from "@/lib/address";
import { isValidPostalCode, normalizePostalCode } from "@/lib/postal-code";
import { z } from "zod";

// ============================================================
// Vendor Single Address
// PATCH  /api/vendor/addresses/[addressId]  — update address
// DELETE /api/vendor/addresses/[addressId]  — delete address
// ============================================================

const patchVendorAddressSchema = z.object({
  label: z.string().max(50).optional(),
  propertyType: z.enum(["HDB", "CONDOMINIUM", "LANDED", "OFFICE", "OTHER"]).optional(),
  postalCode: z.string().min(1).optional(),
  blockNumber: z.string().max(20).optional(),
  streetName: z.string().max(200).optional(),
  buildingName: z.string().max(200).optional(),
  level: z.string().max(10).optional(),
  unitNumber: z.string().max(20).optional(),
  houseNumber: z.string().max(20).optional(),
  streetAddress: z.string().max(200).optional(),
  isDefault: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

// PATCH — update a vendor address
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ addressId: string }> }
) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { addressId } = await params;

    // Verify address belongs to this vendor
    const existing = await db.address.findFirst({
      where: {
        id: addressId,
        ownerType: "VENDOR",
        vendorId: session.vendorId,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = patchVendorAddressSchema.parse(body);

    // Validate postal code if provided
    if (parsed.postalCode) {
      const postalCode = normalizePostalCode(parsed.postalCode);
      if (!isValidPostalCode(postalCode)) {
        return NextResponse.json(
          { error: "Invalid postal code. Must be exactly 6 digits." },
          { status: 400 }
        );
      }
    }

    // Determine effective property type for field validation
    const effectivePropertyType = parsed.propertyType || existing.propertyType;

    // Validate required fields based on property type
    const requiredFields = getRequiredFields(effectivePropertyType);
    const addressData = {
      propertyType: effectivePropertyType,
      postalCode: parsed.postalCode || existing.postalCode,
      blockNumber: parsed.blockNumber !== undefined ? parsed.blockNumber : existing.blockNumber,
      streetName: parsed.streetName !== undefined ? parsed.streetName : existing.streetName,
      buildingName: parsed.buildingName !== undefined ? parsed.buildingName : existing.buildingName,
      level: parsed.level !== undefined ? parsed.level : existing.level,
      unitNumber: parsed.unitNumber !== undefined ? parsed.unitNumber : existing.unitNumber,
      houseNumber: parsed.houseNumber !== undefined ? parsed.houseNumber : existing.houseNumber,
      streetAddress: parsed.streetAddress !== undefined ? parsed.streetAddress : existing.streetAddress,
    };

    const missingFields: string[] = [];
    for (const field of requiredFields) {
      const value = (addressData as Record<string, unknown>)[field];
      if (!value || (typeof value === "string" && value.trim() === "")) {
        missingFields.push(field);
      }
    }
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields for ${effectivePropertyType}: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }

    // Handle isDefault toggle
    if (parsed.isDefault && !existing.isDefault) {
      // Unset other defaults for this vendor
      await db.address.updateMany({
        where: {
          ownerType: "VENDOR",
          vendorId: session.vendorId,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    // Build the full address
    const fullAddress = buildFullAddress(addressData);

    // Update the address
    const updated = await db.address.update({
      where: { id: addressId },
      data: {
        ...parsed,
        postalCode: parsed.postalCode
          ? normalizePostalCode(parsed.postalCode)
          : undefined,
        fullAddress,
      },
    });

    return NextResponse.json({ address: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("[vendor address PATCH] error:", error);
    return NextResponse.json({ error: "Failed to update address" }, { status: 500 });
  }
}

// DELETE — delete a vendor address
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
