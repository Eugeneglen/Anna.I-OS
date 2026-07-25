import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";
import { buildFullAddress, getRequiredFields } from "@/lib/address";
import { isValidPostalCode, normalizePostalCode } from "@/lib/postal-code";
import { z } from "zod";

// ============================================================
// Vendor Address CRUD
// GET  /api/vendor/addresses  — list all addresses
// POST /api/vendor/addresses  — create new address
// ============================================================

const createVendorAddressSchema = z.object({
  label: z.string().max(50).optional(),
  propertyType: z.enum(["HDB", "CONDOMINIUM", "LANDED", "OFFICE", "OTHER"]),
  postalCode: z.string().min(1),
  blockNumber: z.string().max(20).optional(),
  streetName: z.string().max(200).optional(),
  buildingName: z.string().max(200).optional(),
  level: z.string().max(10).optional(),
  unitNumber: z.string().max(20).optional(),
  houseNumber: z.string().max(20).optional(),
  streetAddress: z.string().max(200).optional(),
  isDefault: z.boolean().optional().default(false),
});

// GET — list all addresses for the vendor
export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const addresses = await db.address.findMany({
      where: {
        ownerType: "VENDOR",
        vendorId: session.vendorId,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ addresses });
  } catch (error) {
    console.error("[vendor addresses GET] error:", error);
    return NextResponse.json({ error: "Failed to fetch addresses" }, { status: 500 });
  }
}

// POST — create a new address for the vendor
export async function POST(request: NextRequest) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = createVendorAddressSchema.parse(body);

    // Validate postal code format
    const postalCode = normalizePostalCode(parsed.postalCode);
    if (!isValidPostalCode(postalCode)) {
      return NextResponse.json(
        { error: "Invalid postal code. Must be exactly 6 digits." },
        { status: 400 }
      );
    }

    // Validate required fields based on property type
    const requiredFields = getRequiredFields(parsed.propertyType);
    const missingFields: string[] = [];
    for (const field of requiredFields) {
      const value = (parsed as Record<string, unknown>)[field];
      if (!value || (typeof value === "string" && value.trim() === "")) {
        missingFields.push(field);
      }
    }
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }

    // Build the full address
    const fullAddress = buildFullAddress({
      propertyType: parsed.propertyType,
      postalCode,
      blockNumber: parsed.blockNumber,
      streetName: parsed.streetName,
      buildingName: parsed.buildingName,
      level: parsed.level,
      unitNumber: parsed.unitNumber,
      houseNumber: parsed.houseNumber,
      streetAddress: parsed.streetAddress,
    });

    // If this address is default, unset any other default addresses for this vendor
    if (parsed.isDefault) {
      await db.address.updateMany({
        where: {
          ownerType: "VENDOR",
          vendorId: session.vendorId,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    // Create the address
    const address = await db.address.create({
      data: {
        ownerType: "VENDOR",
        ownerId: session.vendorId,
        vendorId: session.vendorId,
        label: parsed.label,
        propertyType: parsed.propertyType,
        postalCode,
        blockNumber: parsed.blockNumber,
        streetName: parsed.streetName,
        buildingName: parsed.buildingName,
        level: parsed.level,
        unitNumber: parsed.unitNumber,
        houseNumber: parsed.houseNumber,
        streetAddress: parsed.streetAddress,
        fullAddress,
        isDefault: parsed.isDefault,
      },
    });

    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("[vendor addresses POST] error:", error);
    return NextResponse.json({ error: "Failed to create address" }, { status: 500 });
  }
}
