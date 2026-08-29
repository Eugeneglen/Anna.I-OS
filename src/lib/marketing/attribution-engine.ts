/**
 * Attribution Engine
 * =================
 * Multi-touch attribution for campaigns. Records touchpoints
 * (code redeemed, voucher claimed, voucher used, segment targeted)
 * and calculates campaign ROI.
 *
 * The existing applyRedemption() overwrites Household.acquisitionSource
 * on first redemption — this engine ADDS attribution rows instead,
 * preserving the full touchpoint history.
 */

import { db } from "@/lib/db";

// ── Record a touchpoint ──

export async function recordAttribution(params: {
  householdId: string;
  campaignId: string;
  touchpoint: "CODE_REDEEMED" | "VOUCHER_CLAIMED" | "VOUCHER_USED" | "SEGMENT_TARGETED";
  taskId?: string;
  weight?: number;
}): Promise<void> {
  await db.campaignAttribution.create({
    data: {
      householdId: params.householdId,
      campaignId: params.campaignId,
      taskId: params.taskId || null,
      touchpoint: params.touchpoint,
      weight: params.weight ?? 1.0,
    },
  });
}

// ── Get campaign attribution summary ──

export async function getCampaignAttribution(campaignId: string) {
  const attributions = await db.campaignAttribution.findMany({
    where: { campaignId },
    include: {
      household: { select: { id: true, name: true } },
    },
    orderBy: { attributedAt: "desc" },
  });

  const byTouchpoint: Record<string, number> = {};
  for (const a of attributions) {
    byTouchpoint[a.touchpoint] = (byTouchpoint[a.touchpoint] || 0) + 1;
  }

  const uniqueHouseholds = new Set(attributions.map((a) => a.householdId));

  return {
    totalTouchpoints: attributions.length,
    uniqueHouseholds: uniqueHouseholds.size,
    byTouchpoint,
    attributions: attributions.slice(0, 50),
  };
}

// ── Calculate campaign ROI ──

export async function calculateCampaignROI(campaignId: string) {
  // Get all tasks attributed to this campaign (via VOUCHER_USED or CODE_REDEEMED touchpoints)
  const attributions = await db.campaignAttribution.findMany({
    where: {
      campaignId,
      touchpoint: { in: ["VOUCHER_USED", "CODE_REDEEMED"] },
      taskId: { not: null },
    },
    select: { householdId: true, taskId: true },
  });

  if (attributions.length === 0) {
    return {
      revenueAttributedCents: 0,
      discountCostCents: 0,
      incrementalRevenueCents: 0,
      roi: 0,
      attributedOrders: 0,
    };
  }

  // Fetch the attributed tasks
  const taskIds = attributions.map((a) => a.taskId!).filter(Boolean);
  const tasks = await db.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      amountCents: true,
      discountCents: true,
      finalAmountCents: true,
      status: true,
      householdId: true,
      createdAt: true,
    },
  });

  const completedTasks = tasks.filter(
    (t) => t.status === "COMPLETED" || t.status === "VERIFIED" || t.status === "ESCROW_RELEASED",
  );

  const revenueAttributedCents = completedTasks.reduce(
    (s, t) => s + (t.finalAmountCents || t.amountCents || 0),
    0,
  );

  const discountCostCents = completedTasks.reduce(
    (s, t) => s + (t.discountCents || 0),
    0,
  );

  // ── Phase 1 P1-6 fix: fetch ALL tasks for each attributed household (not just
  // the attributed ones). The previous code only looked at attributed tasks when
  // computing "prior orders" — so a household with 50 prior orders on other
  // campaigns was classified as a "first-ever order — 100% incremental" simply
  // because they had no prior attributed tasks to THIS campaign.
  //
  // We fetch ALL the household's completed tasks (any campaign) so the
  // prior-order baseline reflects the household's true ordering behaviour.
  const householdIds = [...new Set(completedTasks.map((t) => t.householdId))];
  const allHouseholdTasks = householdIds.length > 0
    ? await db.task.findMany({
        where: {
          householdId: { in: householdIds },
          status: { in: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"] },
          cancelledAt: null,
        },
        select: {
          id: true,
          householdId: true,
          status: true,
          createdAt: true,
          completedAt: true,
          verifiedAt: true,
          finalAmountCents: true,
          amountCents: true,
        },
      })
    : [];
  const tasksByHousehold = new Map<string, typeof allHouseholdTasks>();
  for (const t of allHouseholdTasks) {
    const arr = tasksByHousehold.get(t.householdId) ?? [];
    arr.push(t);
    tasksByHousehold.set(t.householdId, arr);
  }

  // Estimate incremental revenue:
  // - If the household's last order before the voucher was 90+ days ago → 100% incremental
  // - If order frequency is stable → 50% incremental
  // - If household orders frequently → only the discount is incremental
  // - No prior orders → 100% incremental (new customer)
  let incrementalRevenueCents = 0;

  for (const task of completedTasks) {
    // Use ALL of the household's tasks (not just attributed ones) to compute prior orders.
    const householdTasks = tasksByHousehold.get(task.householdId) ?? [];
    const taskDate = new Date(task.createdAt);
    const priorOrders = householdTasks.filter(
      (t) => new Date(t.createdAt) < taskDate,
    );
    const lastPriorOrder = priorOrders.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];

    if (lastPriorOrder) {
      const daysSinceLastOrder = Math.floor(
        (taskDate.getTime() - new Date(lastPriorOrder.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceLastOrder > 90) {
        // Lapsed customer — 100% incremental
        incrementalRevenueCents += task.finalAmountCents || task.amountCents || 0;
      } else if (priorOrders.length >= 3) {
        // Frequent customer — only discount is incremental
        incrementalRevenueCents += task.discountCents || 0;
      } else {
        // Average customer — 50% incremental
        incrementalRevenueCents += Math.round((task.finalAmountCents || task.amountCents || 0) * 0.5);
      }
    } else {
      // First-ever order — 100% incremental (new customer)
      incrementalRevenueCents += task.finalAmountCents || task.amountCents || 0;
    }
  }

  const roi = discountCostCents > 0
    ? Math.round((incrementalRevenueCents / discountCostCents) * 10) / 10
    : 0;

  return {
    revenueAttributedCents,
    discountCostCents,
    incrementalRevenueCents,
    roi,
    attributedOrders: completedTasks.length,
  };
}

// ── Get campaign funnel (for performance dashboard) ──

export async function getCampaignFunnel(campaignId: string) {
  const [
    campaign,
    vouchersIssued,
    vouchersViewed,
    vouchersRedeemed,
    campaignEvents,
    codeRedemptions,
    segmentMembers,
  ] = await Promise.all([
    db.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, status: true, maxRedemptions: true, redemptionsCount: true },
    }),
    db.voucher.count({ where: { campaignId } }),
    db.campaignEvent.count({ where: { campaignId, eventType: "VOUCHER_VIEWED" } }),
    db.voucher.count({ where: { campaignId, status: "USED" } }),
    db.campaignEvent.findMany({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.codeRedemption.findMany({
      where: { campaignId },
      select: { id: true, discountAppliedCents: true, redeemedAt: true },
    }),
    db.segmentMember.count({
      where: { segment: { campaignId } },
    }),
  ]);

  // Calculate revenue from attributed tasks
  const attributedTaskIds = await db.campaignAttribution.findMany({
    where: { campaignId, taskId: { not: null } },
    select: { taskId: true },
    distinct: ["taskId"],
  });

  let ordersCompleted = 0;
  let revenueGeneratedCents = 0;
  let discountGivenCents = 0;

  if (attributedTaskIds.length > 0) {
    const tasks = await db.task.findMany({
      where: {
        id: { in: attributedTaskIds.map((a) => a.taskId!) },
        status: { in: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"] },
      },
      select: { finalAmountCents: true, amountCents: true, discountCents: true },
    });
    ordersCompleted = tasks.length;
    revenueGeneratedCents = tasks.reduce((s, t) => s + (t.finalAmountCents || t.amountCents || 0), 0);
    discountGivenCents = tasks.reduce((s, t) => s + (t.discountCents || 0), 0);
  }

  const totalDiscountCents = codeRedemptions.reduce((s, r) => s + r.discountAppliedCents, 0);

  // Build timeline from events
  const timeline = campaignEvents
    .map((e) => ({
      date: new Date(e.createdAt).toISOString().slice(0, 10),
      event: e.eventType,
      count: 1,
    }))
    .reduce((acc: Array<{ date: string; event: string; count: number }>, item) => {
      const existing = acc.find(
        (a) => a.date === item.date && a.event === item.event,
      );
      if (existing) {
        existing.count += 1;
      } else {
        acc.push(item);
      }
      return acc;
    }, [])
    .sort((a, b) => a.date.localeCompare(b.date));

  // Customer reactivation: households that ordered after 90+ day gap
  const reactivatedHouseholds = await countReactivatedCustomers(campaignId);

  return {
    targetAudienceSize: Math.max(segmentMembers, vouchersIssued),
    vouchersIssued,
    vouchersViewed,
    vouchersRedeemed,
    ordersGenerated: codeRedemptions.length,
    ordersCompleted,
    revenueGeneratedCents,
    discountGivenCents,
    netRevenueCents: revenueGeneratedCents - discountGivenCents,
    totalDiscountCents,
    customerReactivation: {
      lapsedCustomersReactivated: reactivatedHouseholds.reactivated,
      newCustomersAcquired: reactivatedHouseholds.new,
    },
    timeline,
    rates: {
      viewRate: vouchersIssued > 0 ? Math.round((vouchersViewed / vouchersIssued) * 100) / 100 : 0,
      redemptionRate: vouchersIssued > 0 ? Math.round((vouchersRedeemed / vouchersIssued) * 100) / 100 : 0,
      conversionRate: vouchersIssued > 0 ? Math.round((codeRedemptions.length / vouchersIssued) * 100) / 100 : 0,
      completionRate: codeRedemptions.length > 0 ? Math.round((ordersCompleted / codeRedemptions.length) * 100) / 100 : 0,
    },
  };
}

// ── Count reactivated customers (lapsed 90+ days before voucher, then ordered) ──

async function countReactivatedCustomers(campaignId: string) {
  const attributions = await db.campaignAttribution.findMany({
    where: {
      campaignId,
      touchpoint: { in: ["VOUCHER_USED", "CODE_REDEEMED"] },
      taskId: { not: null },
    },
    select: { householdId: true, taskId: true },
  });

  let reactivated = 0;
  let newCustomers = 0;

  for (const attr of attributions) {
    const task = await db.task.findUnique({
      where: { id: attr.taskId! },
      select: { householdId: true, createdAt: true },
    });
    if (!task) continue;

    const priorTasks = await db.task.findMany({
      where: {
        householdId: task.householdId,
        createdAt: { lt: task.createdAt },
        status: { in: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"] },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    if (priorTasks.length === 0) {
      newCustomers++;
    } else {
      const daysSinceLastOrder = Math.floor(
        (new Date(task.createdAt).getTime() - new Date(priorTasks[0].createdAt).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceLastOrder > 90) {
        reactivated++;
      }
    }
  }

  return { reactivated, new: newCustomers };
}
