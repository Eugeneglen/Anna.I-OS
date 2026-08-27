import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";
import { validateSgPhone } from "@/lib/phone-validation";
import { isValidPostalCode, normalizePostalCode } from "@/lib/postal-code";

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

// GET /api/ops/households/[id] — Fetch household detail (ops only, auth-gated)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const household = await db.household.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        postalCode: true,
        unitNumber: true,
        activeCategories: true,
        preferences: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingProfile: true,
        acquisitionSource: true,
        acquisitionCampaignId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!household) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    const [members, tasks, subscriptions, categoryAutonomy] = await Promise.all([
      db.familyMember.findMany({
        where: { householdId: id },
        orderBy: { createdAt: "asc" },
      }),
      db.task.findMany({
        where: {
          householdId: id,
          OR: [
            { cancelledAt: null },
            { status: { not: "PREDICTED" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        include: {
          jobType: { select: { id: true, name: true, slug: true } },
          quotation: { select: { id: true, totalCents: true, breakdown: true } },
          bookings: {
            include: {
              vendor: {
                select: {
                  id: true, name: true, email: true, phone: true,
                  categories: true, status: true,
                },
              },
            },
          },
          verificationPhotos: true,
          escrowEntries: true,
          attachments: true,
        },
      }),
      db.subscription.findMany({
        where: { householdId: id },
      }),
      db.householdCategoryAutonomy.findMany({
        where: { householdId: id },
        orderBy: { category: "asc" },
      }),
    ]);

    return NextResponse.json({
      household,
      members,
      tasks,
      subscriptions,
      categoryAutonomy,
    });
  } catch (error) {
    console.error("GET /api/ops/households/[id] error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
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

    // Validate phone format if provided
    if (updateData.phone !== undefined && updateData.phone !== null) {
      const phoneResult = validateSgPhone(String(updateData.phone));
      if (!phoneResult.valid) {
        return NextResponse.json(
          { error: phoneResult.error || "Invalid Singapore phone number" },
          { status: 400 }
        );
      }
      updateData.phone = phoneResult.normalized;
    }

    // Validate postal code format if provided
    if (updateData.postalCode !== undefined && updateData.postalCode !== null) {
      const code = normalizePostalCode(String(updateData.postalCode));
      if (!isValidPostalCode(code)) {
        return NextResponse.json(
          { error: "Invalid postal code. Must be exactly 6 digits." },
          { status: 400 }
        );
      }
      updateData.postalCode = code;
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
