import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";

const patchAddonSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; addonId: string }> }
) {
  try {
    // ── Auth: household session ──
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: bookingId, addonId } = await params;

    // ── Parse body ──
    const body = await request.json();
    const parsed = patchAddonSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { action } = parsed.data;

    // ── Validate addon exists and belongs to the right booking ──
    const addon = await db.bookingAddon.findUnique({
      where: { id: addonId },
      include: {
        booking: {
          select: {
            id: true,
            taskId: true,
            vendorId: true,
            task: {
              select: {
                householdId: true,
                category: true,
              },
            },
          },
        },
      },
    });

    if (!addon) {
      return NextResponse.json(
        { error: "Addon not found" },
        { status: 404 }
      );
    }

    // Verify addon belongs to the specified booking
    if (addon.bookingId !== bookingId) {
      return NextResponse.json(
        { error: "Addon does not belong to this booking" },
        { status: 400 }
      );
    }

    // Verify the booking belongs to the user's household
    if (addon.booking.task.householdId !== session.householdId) {
      return NextResponse.json(
        { error: "You do not have permission to manage this addon" },
        { status: 403 }
      );
    }

    // Only pending addons can be approved/rejected
    if (addon.status !== "pending") {
      return NextResponse.json(
        { error: `Addon is already "${addon.status}" and cannot be ${action}d` },
        { status: 409 }
      );
    }

    // ── Update addon ──
    const now = new Date();
    const updatedAddon = await db.bookingAddon.update({
      where: { id: addonId },
      data: {
        status: action === "approve" ? "approved" : "rejected",
        approvedById: session.memberId,
        approvedAt: action === "approve" ? now : null,
        rejectedAt: action === "reject" ? now : null,
      },
    });

    return NextResponse.json({ addon: updatedAddon });
  } catch (error) {
    console.error(
      "PATCH /api/bookings/[id]/addons/[addonId] error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to update addon" },
      { status: 500 }
    );
  }
}
