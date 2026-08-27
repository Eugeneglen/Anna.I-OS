import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { expireVouchers } from "@/lib/marketing/voucher-engine";

// POST /api/ops/marketing/expire-vouchers
// Manually triggers voucher expiry + sends VOUCHER_EXPIRING notifications
// for vouchers expiring within 3 days. Also called by Railway cron.
export async function POST() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const allowed = await hasPermission(session, "marketing", "edit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 1. Expire vouchers past their expiry date
    const expired = await expireVouchers();

    // 2. Send VOUCHER_EXPIRING notifications for vouchers expiring in 3 days
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const expiringVouchers = await db.voucher.findMany({
      where: {
        status: "CLAIMED",
        expiresAt: {
          gte: new Date(),
          lte: threeDaysFromNow,
        },
        notifiedAt: null, // haven't been notified about expiry yet
      },
      include: {
        household: { select: { id: true } },
        campaign: { select: { name: true } },
      },
      take: 100,
    });

    let notified = 0;
    for (const voucher of expiringVouchers) {
      const members = await db.familyMember.findMany({
        where: { householdId: voucher.householdId, isActive: true },
        select: { id: true },
      });

      for (const member of members) {
        await db.notification.create({
          data: {
            householdId: voucher.householdId,
            recipientType: "HOUSEHOLD_MEMBER",
            memberId: member.id,
            channel: "WEB_PUSH",
            eventType: "REBOOKING_PROMPT", // reuse existing type — TODO: add VOUCHER_EXPIRING to enum
            title: "Voucher Expiring Soon",
            body: `Your voucher from "${voucher.campaign.name}" expires on ${new Date(voucher.expiresAt!).toLocaleDateString("en-SG")}. Use it before it's gone!`,
            status: "PENDING",
            referenceType: "voucher",
            referenceId: voucher.id,
          },
        });
      }

      // Mark as notified
      await db.voucher.update({
        where: { id: voucher.id },
        data: { notifiedAt: new Date() },
      });
      notified++;
    }

    return NextResponse.json({
      expired: expired.expired,
      expiringNotified: notified,
    });
  } catch (error) {
    console.error("[/api/ops/marketing/expire-vouchers POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
