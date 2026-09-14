import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import { NotificationChannel, NotificationEventType, RecipientType } from "@prisma/client";

// ── PATCH /api/households/[id]/subscription ──
// Household-initiated subscription actions (e.g. request cancel)
//
// ── P9A-F01/F02 remediation (Phase 9, Section C, carry-forward #1) ──
// This route previously had NO authentication and NO ownership check: an
// anonymous (or any cross-tenant) caller could drive the cancel-request
// flow for ANY household by path id. Additionally the notification create
// was invalid in THREE fields (unknown `metadata` argument — the model has
// no metadata column; recipientType "HOUSEHOLD" is not an enum member; the
// required `channel` was missing), so the route 500'd after reading the
// target subscription. Fixed:
//   1. household session required (401 otherwise)
//   2. path id MUST match the session's householdId (403 otherwise)
//   3. notification create uses valid enum values and fields (the model has
//      NO metadata column — referenceType/referenceId carry the subscription
//      link; recipientType HOUSEHOLD_MEMBER + channel WHATSAPP, same as the
//      escrow flows) — the original create was invalid in THREE fields
//   4. idempotent duplicate guard (no stacked cancel-request notifications)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth: household session ──
  const session = await getHouseholdSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // ── Ownership: the path household MUST be the caller's household ──
  if (id !== session.householdId) {
    return NextResponse.json(
      { error: "You can only manage your own household's subscription" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { action } = body;

  if (action === "request_cancel") {
    try {
      const subscription = await db.subscription.findFirst({
        where: { householdId: id },
        orderBy: { createdAt: "desc" },
      });

      if (!subscription) {
        return NextResponse.json({ error: "No subscription found" }, { status: 404 });
      }

      if (subscription.status !== "ACTIVE") {
        return NextResponse.json(
          { error: "Only active subscriptions can be cancelled" },
          { status: 409 }
        );
      }

      // Idempotency guard: don't stack duplicate cancel-request
      // notifications for the same subscription.
      const existingRequest = await db.notification.findFirst({
        where: {
          householdId: id,
          eventType: NotificationEventType.SYSTEM_ALERT,
          title: "Cancellation Requested",
          referenceType: "subscription",
          referenceId: subscription.id,
        },
      });
      if (existingRequest) {
        return NextResponse.json({
          success: true,
          message: "Cancellation request already submitted",
        });
      }

      // Create a notification for ops about the cancellation request
      // Ops will process the actual cancellation via their panel
      await db.notification.create({
        data: {
          householdId: id,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.SYSTEM_ALERT,
          title: "Cancellation Requested",
          body: "Your subscription cancellation request has been received. Ops will process it within 24 hours.",
          referenceType: "subscription",
          referenceId: subscription.id,
        },
      });

      return NextResponse.json({
        success: true,
        message: "Cancellation request submitted",
      });
    } catch (error) {
      console.error("[Household Subscription PATCH]", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
