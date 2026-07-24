import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// ── PATCH /api/households/[id]/subscription ──
// Household-initiated subscription actions (e.g. request cancel)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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

      // Create a notification for ops about the cancellation request
      // Ops will process the actual cancellation via their panel
      await db.notification.create({
        data: {
          householdId: id,
          recipientType: "HOUSEHOLD",
          eventType: "SYSTEM_ALERT",
          title: "Cancellation Requested",
          body: "Your subscription cancellation request has been received. Ops will process it within 24 hours.",
          metadata: { subscriptionId: subscription.id, action: "cancel_requested" },
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
