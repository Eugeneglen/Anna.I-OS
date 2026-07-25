import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import { buildFullAddress, getRequiredFields } from "@/lib/address";
import { validateSgPhone } from "@/lib/phone-validation";
import { isValidPostalCode, normalizePostalCode } from "@/lib/postal-code";
import { z } from "zod";

// ============================================================
// Household Address CRUD
// GET  /api/households/[id]/addresses  — list all addresses
// POST /api/households/[id]/addresses  — create new address
// ============================================================

const createAddressSchema = z.object({
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
  phone: z.string().max(20).optional(),
});

// GET — list all addresses for a household
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Ensure the session's household matches the route param
    if (session.householdId !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const addresses = await db.address.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        householdId: id,
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ addresses });
  } catch (error) {
    console.error("[household addresses GET] error:", error);
    return NextResponse.json({ error: "Failed to fetch addresses" }, { status: 500 });
  }
}

// POST — create a new address for a household
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Ensure the session's household matches the route param
    if (session.householdId !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = createAddressSchema.parse(body);

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

    // Validate phone if provided
    if (parsed.phone) {
      const phoneResult = validateSgPhone(parsed.phone);
      if (!phoneResult.valid) {
        return NextResponse.json(
          { error: phoneResult.error || "Invalid phone number" },
          { status: 400 }
        );
      }
      // Normalize phone
      parsed.phone = phoneResult.normalized;
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

    // If this address is default, unset any other default addresses for this household
    if (parsed.isDefault) {
      await db.address.updateMany({
        where: {
          ownerType: "HOUSEHOLD",
          householdId: id,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    // Create the address
    const address = await db.address.create({
      data: {
        ownerType: "HOUSEHOLD",
        ownerId: id,
        householdId: id,
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

    // Sync household denormalised fields from the default address
    if (address.isDefault) {
      await syncHouseholdDefaultAddress(id, address);
    }

    // If phone was provided, also update the household phone
    if (parsed.phone) {
      await db.household.update({
        where: { id },
        data: { phone: parsed.phone },
      });
    }

    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("[household addresses POST] error:", error);
    return NextResponse.json({ error: "Failed to create address" }, { status: 500 });
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
