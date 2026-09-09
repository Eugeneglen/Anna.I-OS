import { db } from "@/lib/db";
import { EscrowState, TaskStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Phase 3 · §3.1 — DETERMINISTIC INSIGHT CASE BUILDER
//
// "Existing anomaly detection → AI reasoning": the AI reasons over
// a deterministic snapshot of REAL platform data around one
// anomaly (the anomaly row, its linked task / vendor / escrow /
// household, plus repeat-history context). Every identifier is
// resolved server-side from the anomaly row itself — never from
// client hints. The LLM invents nothing; it narrates what is here.
// ─────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtSgd(cents: number): string {
  return `SGD $${(cents / 100).toFixed(2)}`;
}

export interface AnomalyInsightCase {
  anomaly: {
    id: string;
    type: string;
    severity: string;
    status: string;
    message: string;
    detectedAt: string; // deterministic date
    ageHours: number;
    metadata: unknown;
  };
  household: {
    id: string;
    name: string;
    openTaskCount: number;
    disputedTaskCount: number;
    priorResolvedAnomaliesOfSameType: number;
  };
  task: {
    id: string;
    jobNo: string | null;
    category: string | null;
    status: string | null;
    amount: string | null;
    scheduledDate: string | null;
  } | null;
  vendor: {
    id: string;
    name: string;
    vendorType: string | null;
    status: string | null;
    completedJobs: number;
    activeBookings: number;
  } | null;
  escrow: {
    state: string | null;
    amount: string | null;
    disputedAt: string | null;
    disputeReason: string | null;
  } | null;
  /** Server-verified Phase-2 qualifying gate (task DISPUTED + escrow DISPUTED). */
  qualifiesForCaseBrief: boolean;
}

/**
 * Build the deterministic case for one anomaly. Returns null when the
 * anomaly does not exist (or is no longer ACTIVE — a resolved anomaly
 * generates nothing; its insight, if any, is a review record).
 */
export async function buildAnomalyInsightCase(anomalyId: string): Promise<AnomalyInsightCase | null> {
  const anomaly = await db.anomaly.findUnique({
    where: { id: anomalyId },
    include: {
      household: { select: { id: true, name: true } },
    },
  });
  if (!anomaly || anomaly.status !== "ACTIVE") return null;

  // ── Linked task (server-resolved; may be absent) ──
  const task = anomaly.taskId
    ? await db.task.findUnique({
        where: { id: anomaly.taskId },
        select: {
          id: true,
          jobNo: true,
          category: true,
          status: true,
          amountCents: true,
          scheduledStart: true,
          householdId: true,
        },
      })
    : null;

  // ── Linked vendor: the anomaly's own vendorId, else the vendor of the
  //    task's most recent booking (server-side resolution only) ──
  let vendorId = anomaly.vendorId ?? null;
  if (!vendorId && task) {
    const booking = await db.booking.findFirst({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
      select: { vendorId: true },
    });
    vendorId = booking?.vendorId ?? null;
  }
  const vendor = vendorId
    ? await db.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true, name: true, vendorType: true, status: true },
      })
    : null;

  const [vendorStats, householdTasks, disputedCount, priorSameType, escrowEntry] = await Promise.all([
    vendor
      ? db.booking.aggregate({
          where: { vendorId: vendor.id },
          _count: { _all: true },
        })
      : Promise.resolve(null),
    db.task.findMany({
      where: { householdId: anomaly.householdId, cancelledAt: null },
      select: { status: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
    db.task.count({
      where: { householdId: anomaly.householdId, status: TaskStatus.DISPUTED },
    }),
    db.anomaly.count({
      where: {
        householdId: anomaly.householdId,
        type: anomaly.type,
        status: { not: "ACTIVE" }, // resolved/dismissed history — repeat context
      },
    }),
    task
      ? db.escrowLedger.findFirst({
          where: { taskId: task.id, state: EscrowState.DISPUTED },
          orderBy: { disputedAt: "desc" },
          select: {
            state: true,
            amountCents: true,
            disputedAt: true,
            disputeReason: true,
          },
        })
      : Promise.resolve(null),
  ]);

  // Active bookings for the vendor (structure-scoped to this vendor only).
  const vendorActiveBookings = vendor
    ? await db.booking.count({
        where: { vendorId: vendor.id, status: { in: ["ACCEPTED", "SCHEDULED", "IN_PROGRESS"] } },
      })
    : 0;

  const qualifiesForCaseBrief =
    !!task &&
    task.status === TaskStatus.DISPUTED &&
    !!escrowEntry &&
    escrowEntry.state === EscrowState.DISPUTED;

  const ageHours = Math.max(
    0,
    Math.round((Date.now() - anomaly.createdAt.getTime()) / (60 * 60 * 1000))
  );

  return {
    anomaly: {
      id: anomaly.id,
      type: anomaly.type,
      severity: anomaly.severity,
      status: anomaly.status,
      message: anomaly.message,
      detectedAt: fmtDate(anomaly.createdAt),
      ageHours,
      metadata: anomaly.metadata ?? null,
    },
    household: {
      id: anomaly.household.id,
      name: anomaly.household.name,
      openTaskCount: householdTasks.filter(
        (t) => !["VERIFIED", "ESCROW_RELEASED", "CANCELLED"].includes(t.status)
      ).length,
      disputedTaskCount: disputedCount,
      priorResolvedAnomaliesOfSameType: priorSameType,
    },
    task: task
      ? {
          id: task.id,
          jobNo: task.jobNo,
          category: task.category,
          status: task.status,
          amount: fmtSgd(task.amountCents),
          scheduledDate: task.scheduledStart ? fmtDate(new Date(task.scheduledStart)) : null,
        }
      : null,
    vendor: vendor
      ? {
          id: vendor.id,
          name: vendor.name,
          vendorType: vendor.vendorType,
          status: vendor.status,
          completedJobs: vendorStats?._count._all ?? 0,
          activeBookings: vendorActiveBookings,
        }
      : null,
    escrow: escrowEntry
      ? {
          state: escrowEntry.state,
          amount: fmtSgd(escrowEntry.amountCents),
          disputedAt: escrowEntry.disputedAt ? fmtDate(escrowEntry.disputedAt) : null,
          disputeReason: escrowEntry.disputeReason,
        }
      : null,
    qualifiesForCaseBrief,
  };
}
