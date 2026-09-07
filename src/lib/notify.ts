// ============================================================
// Anna.I — Shared Notification Utility (Phase 5)
// Centralized notification creation + anomaly notification bridge
//
// FIX-1d: creation now cascades into the delivery layer
// (src/lib/notify/delivery.ts) — rows no longer sit PENDING forever:
// each row gets an immediate delivery attempt here, and anything left
// PENDING (failure/no attempt) is retried by the cron sweep at
// POST /api/ops/notifications/dispatch (max 3 attempts).
// ============================================================

import { db } from "@/lib/db";
import {
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
} from "@prisma/client";
import type { Notification } from "@prisma/client";
import type { AnomalyType, AnomalySeverity } from "./types";
import { attemptNotificationDelivery } from "./notify/delivery";

// ─────────────────────────────────────────────────────────────
// Core notification creator
// ─────────────────────────────────────────────────────────────

/**
 * FIX-1d: best-effort IMMEDIATE delivery right after persisting the row.
 *
 * Delivery must never break the caller's request path (the notification
 * row itself is already persisted) — any failure here just leaves the
 * row PENDING for the /api/ops/notifications/dispatch sweep to retry
 * (max MAX_DELIVERY_ATTEMPTS). See src/lib/notify/delivery.ts.
 */
async function deliverImmediately(notification: Notification): Promise<void> {
  try {
    await attemptNotificationDelivery(notification);
  } catch (err) {
    console.error(
      "[notify] Immediate delivery failed (row stays PENDING for the sweep):",
      err
    );
  }
}

interface CreateNotificationParams {
  householdId: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  referenceType?: string | null;
  referenceId?: string | null;
  /** If omitted, notifies all household members */
  memberId?: string | null;
  /** Default: WEB_PUSH. Use WHATSAPP for real delivery channels later. */
  channel?: NotificationChannel;
}

/**
 * Create a notification for one or all household members.
 * If `memberId` is omitted, the notification is created for every member.
 */
export async function createNotification(params: CreateNotificationParams) {
  const {
    householdId,
    eventType,
    title,
    body,
    referenceType = null,
    referenceId = null,
    memberId = null,
    channel = NotificationChannel.WEB_PUSH,
  } = params;

  if (memberId) {
    const notification = await db.notification.create({
      data: {
        householdId,
        recipientType: RecipientType.HOUSEHOLD_MEMBER,
        memberId,
        channel,
        eventType,
        title,
        body,
        status: NotificationStatus.PENDING,
        referenceType,
        referenceId,
      },
    });
    // FIX-1d: attempt delivery through the active channel adapter right
    // away (status → SENT + deliveredAt + deliveredVia on success; on
    // failure the row stays PENDING and the cron sweep retries).
    await deliverImmediately(notification);
  } else {
    // Notify all members in the household
    const members = await db.familyMember.findMany({
      where: { householdId },
      select: { id: true },
    });

    if (members.length === 0) return;

    // FIX-1d: createManyAndReturn (instead of createMany) so the created
    // rows come back and can each get an immediate delivery attempt.
    const created = await db.notification.createManyAndReturn({
      data: members.map((m) => ({
        householdId,
        recipientType: RecipientType.HOUSEHOLD_MEMBER,
        memberId: m.id,
        channel,
        eventType,
        title,
        body,
        status: NotificationStatus.PENDING,
        referenceType,
        referenceId,
      })),
    });

    for (const notification of created) {
      await deliverImmediately(notification);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Anomaly → Notification Bridge
// ─────────────────────────────────────────────────────────────

const ANOMALY_EVENT_MAP: Record<
  AnomalyType,
  { eventType: NotificationEventType; titleTemplate: string }
> = {
  VENDOR_LATE: {
    eventType: NotificationEventType.ANOMALY_VENDOR_LATE,
    titleTemplate: "Vendor Late",
  },
  TASK_OVERDUE: {
    eventType: NotificationEventType.ANOMALY_TASK_OVERDUE,
    titleTemplate: "Task Overdue",
  },
  VERIFICATION_MISSING: {
    eventType: NotificationEventType.ANOMALY_VERIFICATION_MISSING,
    titleTemplate: "Verification Missing",
  },
  RATING_DROP: {
    eventType: NotificationEventType.ANOMALY_RATING_DROP,
    titleTemplate: "Vendor Rating Drop",
  },
  ESCROW_DISPUTED: {
    eventType: NotificationEventType.ANOMALY_ESCROW_DISPUTED,
    titleTemplate: "Escrow Disputed",
  },
};

/** Severity → prefix for the notification title */
function severityPrefix(severity: AnomalySeverity): string {
  switch (severity) {
    case "CRITICAL":
      return "🔴 ";
    case "HIGH":
      return "🟠 ";
    case "MEDIUM":
      return "🟡 ";
    case "LOW":
      return "🔵 ";
  }
}

/**
 * Create a notification from a detected anomaly.
 * Called by the anomaly detector after persisting an anomaly to the DB.
 */
export async function createAnomalyNotification(params: {
  householdId: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  message: string;
  taskId?: string | null;
  bookingId?: string | null;
}) {
  const mapping = ANOMALY_EVENT_MAP[params.type];
  if (!mapping) return;

  await createNotification({
    householdId: params.householdId,
    eventType: mapping.eventType,
    title: `${severityPrefix(params.severity)}${mapping.titleTemplate}`,
    body: params.message,
    referenceType: params.taskId ? "task" : "anomaly",
    referenceId: params.taskId ?? params.bookingId ?? null,
  });
}

// ─────────────────────────────────────────────────────────────
// Fire-and-forget anomaly detection trigger
// ─────────────────────────────────────────────────────────────

/**
 * Trigger anomaly detection in the background (fire-and-forget).
 * Call this after task state changes to surface new anomalies immediately.
 * Errors are logged but never thrown — this is a best-effort background job.
 */
export async function triggerAnomalyDetection(householdId: string) {
  try {
    const { runAnomalyDetection } = await import("@/lib/anomaly-detector");
    await runAnomalyDetection(householdId);
  } catch (err) {
    console.error("[notify] Background anomaly detection failed:", err);
  }
}