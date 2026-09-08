import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { Prisma, EscrowState } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // P5 (AUDIT-4): was session-only — the escrow ledger view now requires
    // escrow:view (all four seeded roles hold it; mutations on
    // /api/ops/escrow/[id] remain COORDINATOR-tier as before).
    const allowed = await hasPermission(session, "escrow", "view");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — requires escrow:view" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const state = sp.get("state") || "";
    const search = sp.get("search") || "";
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    const cursor = sp.get("cursor") || "";
    const limit = Math.min(parseInt(sp.get("limit") || "30"), 50);

    // ── Summary Stats ──
    const [heldEntries, releasedEntries, disputedEntries, refundedEntries] = await Promise.all([
      db.escrowLedger.findMany({ where: { state: EscrowState.HELD } }),
      db.escrowLedger.findMany({ where: { state: EscrowState.RELEASED } }),
      db.escrowLedger.findMany({ where: { state: EscrowState.DISPUTED } }),
      db.escrowLedger.findMany({ where: { state: EscrowState.REFUNDED } }),
    ]);

    const sumAmount = (entries: { amountCents: number }[]) =>
      entries.reduce((s, e) => s + e.amountCents, 0);

    // ── Two-way refund split context in the summary ──
    // Per state: the household cash leg returned (Σ refundCents) and the
    // platform promo leg reversed (Σ subsidyReversedCents). The legacy
    // amountCents keys are unchanged (gross cash ever held in that state)
    // — the split fields carry the net-of-refund truth the KPIs need.
    const refundSplit = (entries: { refundCents: number; subsidyReversedCents: number }[]) => ({
      refundedCents: entries.reduce((s, e) => s + (e.refundCents || 0), 0),
      subsidyReversedCents: entries.reduce((s, e) => s + (e.subsidyReversedCents || 0), 0),
    });

    const summary = {
      HELD: { count: heldEntries.length, amountCents: sumAmount(heldEntries), ...refundSplit(heldEntries) },
      RELEASED: { count: releasedEntries.length, amountCents: sumAmount(releasedEntries), ...refundSplit(releasedEntries) },
      DISPUTED: { count: disputedEntries.length, amountCents: sumAmount(disputedEntries), ...refundSplit(disputedEntries) },
      REFUNDED: { count: refundedEntries.length, amountCents: sumAmount(refundedEntries), ...refundSplit(refundedEntries) },
      total: {
        count: heldEntries.length + releasedEntries.length + disputedEntries.length + refundedEntries.length,
        amountCents: sumAmount(heldEntries) + sumAmount(releasedEntries) + sumAmount(disputedEntries) + sumAmount(refundedEntries),
        ...refundSplit([...heldEntries, ...releasedEntries, ...disputedEntries, ...refundedEntries]),
      },
    };

    // ── Disputed tasks count ──
    const disputedTaskCount = await db.task.count({
      where: { status: "DISPUTED" },
    });

    // ── Pending release tasks (VERIFIED or ESCROW_RELEASED with HELD escrow) ──
    const pendingReleaseCount = await db.task.count({
      where: {
        status: { in: ["VERIFIED", "ESCROW_RELEASED"] },
        escrowEntries: { some: { state: EscrowState.HELD } },
      },
    });

    // ── Pending release tasks details ──
    const pendingReleaseTasks = await db.task.findMany({
      where: {
        status: { in: ["VERIFIED", "ESCROW_RELEASED"] },
        escrowEntries: { some: { state: EscrowState.HELD } },
      },
      take: 10,
      orderBy: { verifiedAt: "asc" },
      select: {
        id: true,
        category: true,
        status: true,
        amountCents: true,
        verifiedAt: true,
        household: { select: { id: true, name: true } },
        escrowEntries: {
          where: { state: EscrowState.HELD },
          select: { id: true, amountCents: true, vendorPayoutCents: true, heldAt: true },
          take: 1,
        },
        bookings: {
          where: { status: { not: "cancelled" } },
          select: { vendor: { select: { id: true, name: true } } },
          take: 1,
        },
      },
    });

    // ── Disputed tasks details ──
    const disputedTasks = await db.task.findMany({
      where: { status: "DISPUTED" },
      take: 10,
      orderBy: { disputedAt: "desc" },
      select: {
        id: true,
        category: true,
        status: true,
        amountCents: true,
        disputedAt: true,
        household: { select: { id: true, name: true } },
        escrowEntries: {
          where: { state: EscrowState.DISPUTED },
          select: { id: true, amountCents: true, state: true, refundCents: true, disputeReason: true, disputedAt: true, heldAt: true },
          orderBy: { disputedAt: "desc" },
        },
        bookings: {
          where: { status: { not: "cancelled" } },
          select: { vendor: { select: { id: true, name: true } } },
          take: 1,
        },
      },
    });

    // ── Ledger entries with filters ──
    const where: Prisma.EscrowLedgerWhereInput = {};

    if (state) {
      where.state = state as EscrowState;
    }

    if (search) {
      where.OR = [
        { task: { household: { name: { contains: search } } } },
        { task: { household: { email: { contains: search } } } },
        { booking: { vendor: { name: { contains: search } } } },
        { booking: { vendor: { email: { contains: search } } } },
      ];
    }

    if (from || to) {
      const dateFilter: Prisma.EscrowLedgerWhereInput = {};
      if (from && !to) {
        dateFilter.createdAt = { gte: new Date(from) };
      } else if (to && !from) {
        dateFilter.createdAt = { lte: new Date(to) };
      } else if (from && to) {
        dateFilter.createdAt = { gte: new Date(from), lte: new Date(to) };
      }
      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
      where.AND = [...existingAnd, dateFilter];
    }

    const entries = await db.escrowLedger.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amountCents: true,
        state: true,
        commissionRate: true,
        commissionCents: true,
        vendorPayoutCents: true,
        heldAt: true,
        releasedAt: true,
        disputedAt: true,
        refundedAt: true,
        disputeReason: true,
        disputeResolution: true,
        disputeResolvedBy: true,
        disputeResolvedAt: true,
        createdAt: true,
        // ── Two-way refund split context (ops ledger rows must explain
        // themselves — FIN-AUDIT-3 warning: "ops ledger UI can't explain
        // rows"). original/discount/funder explain the amount vs payout gap;
        // refundCents + subsidyReversedCents are the two refund legs. ──
        originalAmountCents: true,
        discountCents: true,
        discountFundedBy: true,
        refundCents: true,
        refundCreditCents: true,
        subsidyReversedCents: true,
        task: {
          select: {
            id: true,
            category: true,
            status: true,
            amountCents: true,
            disputedAt: true,
            household: {
              select: { id: true, name: true, address: true, postalCode: true },
            },
          },
        },
        booking: {
          select: {
            id: true,
            status: true,
            vendor: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    const hasMore = entries.length > limit;
    if (hasMore) entries.pop();

    const nextCursor = hasMore && entries.length > 0 ? entries[entries.length - 1].id : null;

    return NextResponse.json({
      summary,
      disputedTaskCount,
      pendingReleaseCount,
      pendingReleaseTasks,
      disputedTasks,
      entries,
      nextCursor,
    });
  } catch (error) {
    console.error("[/api/ops/escrow GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
