// ============================================================
// Anna.I — Anomaly Detection Engine (Phase 3)
// Rule-based detection for vendor/household deviations
// ============================================================

import { db } from "@/lib/db";
import {
  VENDOR_LATE_SLA_MINUTES,
  TASK_OVERDUE_SLA_HOURS,
  VERIFICATION_MISSING_SLA_HOURS,
  RATING_DROP_THRESHOLD,
} from "@/lib/constants";
import { createAnomalyNotification } from "@/lib/notify";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface DetectedAnomaly {
  householdId: string;
  taskId?: string;
  bookingId?: string;
  vendorId?: string;
  type: "VENDOR_LATE" | "TASK_OVERDUE" | "VERIFICATION_MISSING" | "RATING_DROP" | "ESCROW_DISPUTED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  metadata: Record<string, unknown>;
}

interface DetectionResult {
  detected: number;
  created: number;
  skipped: number;
  anomalies: DetectedAnomaly[];
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function minutesAgo(date: Date, minutes: number): boolean {
  return Date.now() - date.getTime() > minutes * 60 * 1000;
}

function hoursAgo(date: Date, hours: number): boolean {
  return Date.now() - date.getTime() > hours * 60 * 60 * 1000;
}

/** Check if an active anomaly already exists for this (household, type, bookingId/taskId) combo */
async function existingActiveAnomaly(
  householdId: string,
  type: string,
  bookingId?: string,
  taskId?: string
): Promise<boolean> {
  const where: Record<string, unknown> = {
    householdId,
    type,
    status: "ACTIVE",
  };
  if (bookingId) where.bookingId = bookingId;
  else if (taskId) where.taskId = taskId;

  const count = await db.anomaly.count({ where });
  return count > 0;
}

// ─────────────────────────────────────────────────────────────
// Rule 1: VENDOR_LATE
// Vendor hasn't started 30+ min after scheduled start
// ─────────────────────────────────────────────────────────────

async function detectVendorLate(): Promise<DetectedAnomaly[]> {
  const results: DetectedAnomaly[] = [];

  // Find accepted/in_progress bookings past the SLA window with no actualStart
  const slaCutoff = new Date(Date.now() - VENDOR_LATE_SLA_MINUTES * 60 * 1000);

  const bookings = await db.booking.findMany({
    where: {
      scheduledStart: { lt: slaCutoff },
      actualStart: null,
      status: { in: ["assigned", "accepted", "in_progress"] },
    },
    include: {
      task: { select: { id: true, householdId: true, category: true } },
      vendor: { select: { id: true, name: true } },
    },
  });

  for (const b of bookings) {
    const hhId = b.task.householdId;
    if (await existingActiveAnomaly(hhId, "VENDOR_LATE", b.id)) continue;

    const minutesLate = Math.round(
      (Date.now() - new Date(b.scheduledStart).getTime()) / (60 * 1000)
    );

    results.push({
      householdId: hhId,
      taskId: b.task.id,
      bookingId: b.id,
      vendorId: b.vendorId,
      type: "VENDOR_LATE",
      severity: minutesLate > 120 ? "HIGH" : minutesLate > 60 ? "MEDIUM" : "LOW",
      message: `${b.vendor.name} is ${minutesLate} min late for ${b.task.category.toLowerCase()} (scheduled ${new Date(b.scheduledStart).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })})`,
      metadata: {
        vendorName: b.vendor.name,
        scheduledStart: b.scheduledStart,
        minutesLate,
        bookingStatus: b.status,
      },
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Rule 2: TASK_OVERDUE
// Task dispatched 4+ hours ago, still not completed
// ─────────────────────────────────────────────────────────────

async function detectTaskOverdue(): Promise<DetectedAnomaly[]> {
  const results: DetectedAnomaly[] = [];

  const slaCutoff = new Date(Date.now() - TASK_OVERDUE_SLA_HOURS * 60 * 60 * 1000);

  const tasks = await db.task.findMany({
    where: {
      status: { in: ["DISPATCHED", "IN_PROGRESS"] },
      dispatchedAt: { lt: slaCutoff },
      completedAt: null,
    },
    include: {
      bookings: {
        where: { status: { not: "cancelled" } },
        take: 1,
        include: { vendor: { select: { id: true, name: true } } },
      },
    },
  });

  for (const t of tasks) {
    if (await existingActiveAnomaly(t.householdId, "TASK_OVERDUE", undefined, t.id))
      continue;

    const hoursOverdue = Math.round(
      (Date.now() - new Date(t.dispatchedAt!).getTime()) / (60 * 60 * 1000)
    );
    const vendorName = t.bookings[0]?.vendor?.name ?? "Unknown vendor";

    results.push({
      householdId: t.householdId,
      taskId: t.id,
      bookingId: t.bookings[0]?.id,
      vendorId: t.bookings[0]?.vendorId,
      type: "TASK_OVERDUE",
      severity: hoursOverdue > 12 ? "CRITICAL" : hoursOverdue > 8 ? "HIGH" : "MEDIUM",
      message: `${t.category.toLowerCase()} task is ${hoursOverdue}h overdue (vendor: ${vendorName})`,
      metadata: {
        category: t.category,
        dispatchedAt: t.dispatchedAt,
        hoursOverdue,
        vendorName,
      },
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Rule 3: VERIFICATION_MISSING
// Task completed 24+ hours ago, no verification photo uploaded
// ─────────────────────────────────────────────────────────────

async function detectVerificationMissing(): Promise<DetectedAnomaly[]> {
  const results: DetectedAnomaly[] = [];

  const slaCutoff = new Date(Date.now() - VERIFICATION_MISSING_SLA_HOURS * 60 * 60 * 1000);

  const tasks = await db.task.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { lt: slaCutoff },
      verificationPhotos: { none: {} },
    },
    include: {
      bookings: {
        where: { status: { not: "cancelled" } },
        take: 1,
        include: { vendor: { select: { id: true, name: true } } },
      },
    },
  });

  for (const t of tasks) {
    if (await existingActiveAnomaly(t.householdId, "VERIFICATION_MISSING", undefined, t.id))
      continue;

    const hoursSinceCompletion = Math.round(
      (Date.now() - new Date(t.completedAt!).getTime()) / (60 * 60 * 1000)
    );
    const vendorName = t.bookings[0]?.vendor?.name ?? "Unknown vendor";

    results.push({
      householdId: t.householdId,
      taskId: t.id,
      bookingId: t.bookings[0]?.id,
      vendorId: t.bookings[0]?.vendorId,
      type: "VERIFICATION_MISSING",
      severity: hoursSinceCompletion > 72 ? "HIGH" : "MEDIUM",
      message: `Verification photo missing for ${hoursSinceCompletion}h after ${t.category.toLowerCase()} completion`,
      metadata: {
        category: t.category,
        completedAt: t.completedAt,
        hoursSinceCompletion,
        vendorName,
      },
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Rule 4: RATING_DROP
// Latest booking rating is significantly below vendor's average
// ─────────────────────────────────────────────────────────────

async function detectRatingDrop(): Promise<DetectedAnomaly[]> {
  const results: DetectedAnomaly[] = [];

  // Find all completed bookings with ratings, grouped by vendor
  const vendors = await db.vendor.findMany({
    where: { status: "ACTIVE" },
    include: {
      bookings: {
        where: {
          status: "completed",
          rating: { not: null },
        },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          taskId: true,
          rating: true,
          completedAt: true,
          task: { select: { householdId: true, category: true } },
        },
      },
    },
  });

  for (const v of vendors) {
    if (v.bookings.length < 3) continue; // Need history to establish a baseline

    // Latest rating
    const latest = v.bookings[0];
    if (!latest.rating) continue;

    // Historical average (exclude latest)
    const historicalRatings = v.bookings.slice(1).map((b) => b.rating!);
    const avgRating =
      historicalRatings.reduce((sum, r) => sum + r, 0) / historicalRatings.length;

    const drop = avgRating - latest.rating;
    if (drop >= RATING_DROP_THRESHOLD) {
      const hhId = latest.task.householdId;
      if (await existingActiveAnomaly(hhId, "RATING_DROP", latest.id)) continue;

      results.push({
        householdId: hhId,
        taskId: latest.taskId,
        bookingId: latest.id,
        vendorId: v.id,
        type: "RATING_DROP",
        severity: drop >= 2.5 ? "HIGH" : "MEDIUM",
        message: `${v.name} rated ${latest.rating}/5 (avg: ${avgRating.toFixed(1)}) — ${drop.toFixed(1)} point drop`,
        metadata: {
          vendorName: v.name,
          currentRating: latest.rating,
          avgRating: Math.round(avgRating * 10) / 10,
          ratingDrop: Math.round(drop * 10) / 10,
          historyCount: historicalRatings.length,
        },
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Rule 5: ESCROW_DISPUTED (event-driven — detect from DB state)
// ─────────────────────────────────────────────────────────────

async function detectEscrowDisputed(): Promise<DetectedAnomaly[]> {
  const results: DetectedAnomaly[] = [];

  const disputedEscrows = await db.escrowLedger.findMany({
    where: {
      state: "DISPUTED",
      disputedAt: { not: null },
    },
    include: {
      task: {
        select: {
          id: true,
          householdId: true,
          category: true,
          disputedAt: true,
          bookings: {
            where: { status: { not: "cancelled" } },
            take: 1,
            include: { vendor: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  for (const e of disputedEscrows) {
    const t = e.task;
    if (!t.disputedAt) continue;

    const hhId = t.householdId;
    if (await existingActiveAnomaly(hhId, "ESCROW_DISPUTED", undefined, t.id)) continue;

    const vendorName = t.bookings[0]?.vendor?.name ?? "Unknown vendor";

    results.push({
      householdId: hhId,
      taskId: t.id,
      bookingId: t.bookings[0]?.id,
      vendorId: t.bookings[0]?.vendorId,
      type: "ESCROW_DISPUTED",
      severity: "CRITICAL",
      message: `Escrow disputed for ${t.category.toLowerCase()} (${(e.amountCents / 100).toFixed(2)} SGD) — ${e.disputeReason ?? "No reason provided"}`,
      metadata: {
        category: t.category,
        amountCents: e.amountCents,
        disputeReason: e.disputeReason,
        vendorName,
        disputedAt: t.disputedAt,
      },
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Main: Run all detection rules and persist new anomalies
// ─────────────────────────────────────────────────────────────

export async function runAnomalyDetection(
  householdId?: string
): Promise<DetectionResult> {
  const allDetected: DetectedAnomaly[] = [];

  // Run all 5 rules
  const [vendorLate, taskOverdue, verificationMissing, ratingDrop, escrowDisputed] =
    await Promise.all([
      detectVendorLate(),
      detectTaskOverdue(),
      detectVerificationMissing(),
      detectRatingDrop(),
      detectEscrowDisputed(),
    ]);

  allDetected.push(
    ...vendorLate,
    ...taskOverdue,
    ...verificationMissing,
    ...ratingDrop,
    ...escrowDisputed
  );

  // Filter by household if specified
  const filtered = householdId
    ? allDetected.filter((a) => a.householdId === householdId)
    : allDetected;

  // Persist new anomalies (skip duplicates — checked per-rule above)
  let created = 0;
  for (const a of filtered) {
    await db.anomaly.create({
      data: {
        householdId: a.householdId,
        taskId: a.taskId,
        bookingId: a.bookingId,
        vendorId: a.vendorId,
        type: a.type,
        severity: a.severity,
        message: a.message,
        metadata: a.metadata,
      },
    });
    created++;

    // Phase 5: Bridge — create a notification for the anomaly
    await createAnomalyNotification({
      householdId: a.householdId,
      type: a.type,
      severity: a.severity,
      message: a.message,
      taskId: a.taskId,
      bookingId: a.bookingId,
    });
  }

  const skipped = allDetected.length - filtered.length;

  return {
    detected: allDetected.length,
    created,
    skipped,
    anomalies: filtered,
  };
}