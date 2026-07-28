import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";

// Allowed fields for PATCH
const ALLOWED_FIELDS = [
  "name",
  "fullName",
  "phone",
  "address",
  "postalCode",
  "unitNumber",
  "preferences",
] as const;

type AllowedField = (typeof ALLOWED_FIELDS)[number];

function isAllowedField(key: string): key is AllowedField {
  return (ALLOWED_FIELDS as readonly string[]).includes(key);
}

// PATCH /api/ops/households/[id] — Update a household (admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Check household exists
    const existing = await db.household.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    const body = await req.json();
    const changedFields: Record<string, unknown> = {};
    const updateData: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body)) {
      if (!isAllowedField(key)) continue;
      updateData[key] = value;
      changedFields[key] = value;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Validate name and address if provided
    if (updateData.name !== undefined && typeof updateData.name !== "string") {
      return NextResponse.json(
        { error: "Field 'name' must be a string" },
        { status: 400 }
      );
    }

    if (updateData.address !== undefined && typeof updateData.address !== "string") {
      return NextResponse.json(
        { error: "Field 'address' must be a string" },
        { status: 400 }
      );
    }

    // Audit the change
    await logAction({
      userId: session.userId,
      userName: session.name,
      action: "UPDATE_HOUSEHOLD",
      entityType: "HOUSEHOLD",
      entityId: id,
      metadata: { changedFields },
    });

    const updated = await db.household.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      household: updated,
    });
  } catch (error) {
    console.error("[/api/ops/households/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
