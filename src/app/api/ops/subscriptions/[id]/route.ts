import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import {
  RecipientType,
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
} from "@prisma/client";
import { getTierPriceCents, formatTierMonthly } from "@/lib/subscription-pricing";

// ── F-5 (Item 8): tier prices come from the single application authority ──
// (subscription-pricing.ts). This local map previously re-declared the
// figures — a second place to drift.
const TIER_PRICES: Record<string, number> = {
  HOME: getTierPriceCents("HOME"), // SGD $8/mo
  CARE: getTierPriceCents("CARE"), // SGD $68/mo
};

/**
 * ── Item 8 notification fix ──
 * The previous notification create was TRIPLE-INVALID: recipientType
 * "HOUSEHOLD" is not in the RecipientType enum (only HOUSEHOLD_MEMBER /
 * VENDOR), the required `channel` was missing, and a `metadata` arg the
 * Notification model does not have — Prisma threw, the whole PATCH 500'd
 * AFTER the tier row was already written (torn write), and the household
 * never got told. Now: one VALID notification per household member, copy
 * derived from the pricing module.
 */
async function notifyHouseholdTierChange(
  householdId: string,
  subscriptionId: string,
  title: string,
  body: string
): Promise<void> {
  const members = await db.familyMember.findMany({
    where: { householdId },
    select: { id: true },
  });
  if (members.length === 0) return;
  await db.notification.createMany({
    data: members.map((member) => ({
      householdId,
      recipientType: RecipientType.HOUSEHOLD_MEMBER,
      memberId: member.id,
      channel: NotificationChannel.WEB_PUSH,
      eventType: NotificationEventType.SYSTEM_ALERT,
      title,
      body,
      status: NotificationStatus.PENDING,
      referenceType: "subscription",
      referenceId: subscriptionId,
    })),
  });
}

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
            priceChange: { from: getTierPriceCents("HOME"), to: getTierPriceCents("CARE") },
            notes: notes || null,
          },
        },
      });

      // Create household notification (Item 8 fix: valid recipient/channel,
      // module-derived copy)
      await notifyHouseholdTierChange(
        subscription.householdId,
        id,
        "Subscription Upgraded",
        `Your plan has been upgraded to Anna.I Care (${formatTierMonthly("CARE")}/mo). Enjoy premium eldercare companion bundles and priority support.`
      );

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
            priceChange: { from: getTierPriceCents("CARE"), to: getTierPriceCents("HOME") },
            notes: notes || null,
          },
        },
      });

      await notifyHouseholdTierChange(
        subscription.householdId,
        id,
        "Plan Changed",
        `Your plan has been changed to Anna.I Home (${formatTierMonthly("HOME")}/mo). Care tier benefits are no longer active.`
      );

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

      await notifyHouseholdTierChange(
        subscription.householdId,
        id,
        "Subscription Cancelled",
        `Your Anna.I ${subscription.tier} subscription has been cancelled. You can reactivate at any time from Settings.`
      );

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

      await notifyHouseholdTierChange(
        subscription.householdId,
        id,
        "Subscription Reactivated",
        `Welcome back! Your Anna.I ${updated.tier} subscription is now active again.`
      );

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
