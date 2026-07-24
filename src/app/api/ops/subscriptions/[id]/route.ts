import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";

// ── PATCH /api/ops/subscriptions/[id] ──
// Ops manages subscription: change tier, status, billing dates
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getOpsSession();
  if (!session || !hasMinRole(session.role, "COORDINATOR")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { action, notes } = body;

  try {
    const subscription = await db.subscription.findUnique({
      where: { id },
      include: { household: { select: { name: true, email: true } } },
    });

    if (!subscription) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const TIER_PRICES: Record<string, number> = {
      HOME: 800,    // SGD $8/mo
      CARE: 6800,   // SGD $68/mo
    };

    if (action === "upgrade_tier") {
      // HOME → CARE upgrade
      if (subscription.tier !== "HOME") {
        return NextResponse.json(
          { error: "Can only upgrade from HOME to CARE tier" },
          { status: 409 }
        );
      }
      if (subscription.status !== "ACTIVE") {
        return NextResponse.json(
          { error: "Subscription must be ACTIVE to upgrade" },
          { status: 409 }
        );
      }

      const updated = await db.subscription.update({
        where: { id },
        data: {
          tier: "CARE",
          priceCents: TIER_PRICES.CARE,
          billingCycleStart: new Date(), // Reset cycle on upgrade
        },
      });

      // Audit log
      await db.auditLog.create({
        data: {
          userId: session.userId,
          userName: session.name,
          action: "UPGRADE_TIER",
          entityType: "Subscription",
          entityId: id,
          metadata: {
            from: "HOME",
            to: "CARE",
            householdName: subscription.household.name,
            priceChange: { from: 800, to: 6800 },
            notes: notes || null,
          },
        },
      });

      // Create household notification
      await db.notification.create({
        data: {
          householdId: subscription.householdId,
          recipientType: "HOUSEHOLD",
          eventType: "SYSTEM_ALERT",
          title: "Subscription Upgraded",
          body: `Your plan has been upgraded to Anna.I Care (SGD $68/mo). Enjoy premium eldercare companion bundles and priority support.`,
          metadata: { subscriptionId: id, tier: "CARE" },
        },
      });

      return NextResponse.json({ subscription: updated });
    }

    if (action === "downgrade_tier") {
      // CARE → HOME downgrade
      if (subscription.tier !== "CARE") {
        return NextResponse.json(
          { error: "Can only downgrade from CARE to HOME tier" },
          { status: 409 }
        );
      }
      if (subscription.status !== "ACTIVE") {
        return NextResponse.json(
          { error: "Subscription must be ACTIVE to downgrade" },
          { status: 409 }
        );
      }

      const updated = await db.subscription.update({
        where: { id },
        data: {
          tier: "HOME",
          priceCents: TIER_PRICES.HOME,
          billingCycleStart: new Date(),
        },
      });

      await db.auditLog.create({
        data: {
          userId: session.userId,
          userName: session.name,
          action: "DOWNGRADE_TIER",
          entityType: "Subscription",
          entityId: id,
          metadata: {
            from: "CARE",
            to: "HOME",
            householdName: subscription.household.name,
            priceChange: { from: 6800, to: 800 },
            notes: notes || null,
          },
        },
      });

      await db.notification.create({
        data: {
          householdId: subscription.householdId,
          recipientType: "HOUSEHOLD",
          eventType: "SYSTEM_ALERT",
          title: "Plan Changed",
          body: `Your plan has been changed to Anna.I Home (SGD $8/mo). Care tier benefits are no longer active.`,
          metadata: { subscriptionId: id, tier: "HOME" },
        },
      });

      return NextResponse.json({ subscription: updated });
    }

    if (action === "cancel") {
      if (subscription.status !== "ACTIVE") {
        return NextResponse.json(
          { error: "Only ACTIVE subscriptions can be cancelled" },
          { status: 409 }
        );
      }

      const updated = await db.subscription.update({
        where: { id },
        data: {
          status: "CANCELLED",
        },
      });

      await db.auditLog.create({
        data: {
          userId: session.userId,
          userName: session.name,
          action: "CANCEL",
          entityType: "Subscription",
          entityId: id,
          metadata: {
            tier: subscription.tier,
            priceCents: subscription.priceCents,
            householdName: subscription.household.name,
            notes: notes || null,
          },
        },
      });

      await db.notification.create({
        data: {
          householdId: subscription.householdId,
          recipientType: "HOUSEHOLD",
          eventType: "SYSTEM_ALERT",
          title: "Subscription Cancelled",
          body: `Your Anna.I ${subscription.tier} subscription has been cancelled. You can reactivate at any time from Settings.`,
          metadata: { subscriptionId: id, tier: subscription.tier },
        },
      });

      return NextResponse.json({ subscription: updated });
    }

    if (action === "reactivate") {
      if (subscription.status !== "CANCELLED" && subscription.status !== "PAST_DUE") {
        return NextResponse.json(
          { error: "Only CANCELLED or PAST_DUE subscriptions can be reactivated" },
          { status: 409 }
        );
      }

      const updated = await db.subscription.update({
        where: { id },
        data: {
          status: "ACTIVE",
          billingCycleStart: new Date(),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      await db.auditLog.create({
        data: {
          userId: session.userId,
          userName: session.name,
          action: "REACTIVATE",
          entityType: "Subscription",
          entityId: id,
          metadata: {
            from: subscription.status,
            householdName: subscription.household.name,
            notes: notes || null,
          },
        },
      });

      await db.notification.create({
        data: {
          householdId: subscription.householdId,
          recipientType: "HOUSEHOLD",
          eventType: "SYSTEM_ALERT",
          title: "Subscription Reactivated",
          body: `Welcome back! Your Anna.I ${updated.tier} subscription is now active again.`,
          metadata: { subscriptionId: id, tier: updated.tier },
        },
      });

      return NextResponse.json({ subscription: updated });
    }

    if (action === "mark_past_due") {
      if (subscription.status !== "ACTIVE") {
        return NextResponse.json(
          { error: "Only ACTIVE subscriptions can be marked past due" },
          { status: 409 }
        );
      }

      const updated = await db.subscription.update({
        where: { id },
        data: { status: "PAST_DUE" },
      });

      await db.auditLog.create({
        data: {
          userId: session.userId,
          userName: session.name,
          action: "MARK_PAST_DUE",
          entityType: "Subscription",
          entityId: id,
          metadata: {
            tier: subscription.tier,
            householdName: subscription.household.name,
            notes: notes || null,
          },
        },
      });

      return NextResponse.json({ subscription: updated });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[OPS Subscriptions PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
