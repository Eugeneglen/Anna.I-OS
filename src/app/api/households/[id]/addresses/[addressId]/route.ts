import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import { buildFullAddress, getRequiredFields } from "@/lib/address";
import { isValidPostalCode, normalizePostalCode } from "@/lib/postal-code";
import { z } from "zod";

// ============================================================
// Single Address CRUD
// PATCH   /api/households/[id]/addresses/[addressId]  — update
// DELETE  /api/households/[id]/addresses/[addressId]  — delete
// ============================================================

const patchAddressSchema = z.object({
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
  phone: z.string().max(20).optional(),
});

// PATCH — update an address
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addressId: string }> }
) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, addressId } = await params;

    // Ensure the session's household matches the route param
    if (session.householdId !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify the address belongs to this household
    const existing = await db.address.findFirst({
      where: {
        id: addressId,
        ownerType: "HOUSEHOLD",
        householdId: id,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = patchAddressSchema.parse(body);

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
    let shouldSyncHousehold = false;
    if (parsed.isDefault && !existing.isDefault) {
      // Unset other defaults for this household
      await db.address.updateMany({
        where: {
          ownerType: "HOUSEHOLD",
          householdId: id,
          isDefault: true,
        },
        data: { isDefault: false },
      });
      shouldSyncHousehold = true;
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

    // Sync household denormalised fields if this is the new default
    if (shouldSyncHousehold && updated.isDefault) {
      await syncHouseholdDefaultAddress(id, updated);
    }

    return NextResponse.json({ address: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("[household address PATCH] error:", error);
    return NextResponse.json({ error: "Failed to update address" }, { status: 500 });
  }
}

// DELETE — delete an address (prevent deleting the last remaining one)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; addressId: string }> }
) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id, addressId } = await params;

    // Ensure the session's household matches the route param
    if (session.householdId !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify the address belongs to this household
    const existing = await db.address.findFirst({
      where: {
        id: addressId,
        ownerType: "HOUSEHOLD",
        householdId: id,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }

    // Count remaining addresses for this household
    const count = await db.address.count({
      where: {
        ownerType: "HOUSEHOLD",
        householdId: id,
      },
    });

    if (count <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last remaining address" },
        { status: 400 }
      );
    }

    // Delete the address
    await db.address.delete({
      where: { id: addressId },
    });

    // If the deleted address was the default, make the oldest remaining one default
    if (existing.isDefault) {
      const nextDefault = await db.address.findFirst({
        where: {
          ownerType: "HOUSEHOLD",
          householdId: id,
        },
        orderBy: { createdAt: "asc" },
      });

      if (nextDefault) {
        await db.address.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });

        // Sync household denormalised fields
        await syncHouseholdDefaultAddress(id, nextDefault);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[household address DELETE] error:", error);
    return NextResponse.json({ error: "Failed to delete address" }, { status: 500 });
  }
}

// ─── Helper: sync denormalised fields on household ────────

async function syncHouseholdDefaultAddress(
  householdId: string,
  address: {
    fullAddress: string;
    postalCode: string;
    unitNumber?: string | null;
    level?: string | null;
  }
) {
  const unitString = address.level && address.unitNumber
    ? `#${address.level}-${address.unitNumber}`
    : address.unitNumber || null;

  await db.household.update({
    where: { id: householdId },
    data: {
      address: address.fullAddress,
      postalCode: address.postalCode,
      unitNumber: unitString,
    },
  });
}
