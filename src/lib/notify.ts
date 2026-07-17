// ============================================================
// Anna.I — Shared Notification Utility (Phase 5)
// Centralized notification creation + anomaly notification bridge
// ============================================================

import { db } from "@/lib/db";
import {
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
} from "@prisma/client";
import type { AnomalyType, AnomalySeverity } from "./types";

// ─────────────────────────────────────────────────────────────
// Core notification creator
// ─────────────────────────────────────────────────────────────

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
    await db.notification.create({
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
  } else {
    // Notify all members in the household
    const members = await db.familyMember.findMany({
      where: { householdId },
      select: { id: true },
    });

    if (members.length === 0) return;

    await db.notification.createMany({
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