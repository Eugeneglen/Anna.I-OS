// ============================================================
// Anna.I — Notification Delivery Layer (FIX-1d)
// ============================================================
// Provider-agnostic delivery seam for the notification pipeline.
//
// Before FIX-1d every Notification row was written with status PENDING
// and stayed PENDING forever: `channel` was a label, the delivery
// fields (sentAt/deliveredAt/externalMessageId) were never written and
// no code path attempted actual delivery ("DB theater" per audit).
//
// This module adds the missing delivery layer:
//   • DeliveryChannel interface — the adapter seam
//   • LogDeliveryChannel — default adapter (structured console log)
//   • attemptNotificationDelivery() — one delivery attempt + row update
//   • processPendingNotifications() — the retry sweep (cron-driven)
//
// NOTE ON THE EXTERNAL COMMS PROVIDER (flagged, deliberately not wired):
// choosing an email/SMS/WhatsApp provider is a SEPARATE pending business
// decision (parallel to the payment-gateway decision). Until that config
// lands, EVERY channel routes to the LogDeliveryChannel — the seam,
// retry bookkeeping and the 60s sweep all work end-to-end, and swapping
// in a real adapter is a one-line change in getDeliveryChannel().
//
// Pending external adapters (do NOT implement until provider is chosen):
//   • EmailDeliveryChannel    — for channel EMAIL    (SMTP / Resend / SES)
//   • SmsDeliveryChannel      — future               (Twilio / Vonage)
//   • WhatsAppDeliveryChannel — for channel WHATSAPP (Twilio / Meta Cloud API)
//   • WebPushDeliveryChannel   — for channel WEB_PUSH (web-push / FCM)
// ============================================================

import type { Notification } from "@prisma/client";
import { NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";

/** Hard cap on delivery attempts per notification (immediate + retries). */
export const MAX_DELIVERY_ATTEMPTS = 3;

// ─────────────────────────────────────────────────────────────
// Channel adapter seam
// ─────────────────────────────────────────────────────────────

/** Result of one delivery attempt through a channel adapter. */
export interface DeliveryResult {
  ok: boolean;
  /** Provider message id / SID (e.g. "log:<notificationId>", Twilio SID). */
  providerRef?: string;
  /** Human-readable failure reason when ok is false. */
  error?: string;
}

/**
 * A delivery channel adapter. Implementations must never throw —
 * return { ok: false, error } instead so the retry bookkeeping can
 * record the failure (defensive try/catch is still applied by the
 * caller for third-party SDK misbehavior).
 */
export interface DeliveryChannel {
  /** Stable adapter key, persisted on the row as `deliveredVia`. */
  key: string;
  send(notification: Notification): Promise<DeliveryResult>;
}

/**
 * Default adapter: emits one structured, grep-able log line per
 * notification. Always succeeds — the row transitions PENDING → SENT
 * with deliveredVia "log" and providerRef "log:<notificationId>", so
 * the whole lifecycle is observable without an external provider.
 */
export class LogDeliveryChannel implements DeliveryChannel {
  readonly key = "log";

  async send(notification: Notification): Promise<DeliveryResult> {
    const recipientRef =
      notification.recipientType === "VENDOR"
        ? `vendor:${notification.vendorId ?? "unknown"}`
        : `member:${notification.memberId ?? "unknown"}@household:${notification.householdId}`;
    console.log(
      `[notification:deliver] id=${notification.id} channel=${notification.channel} adapter=${this.key} recipient=${recipientRef} title="${notification.title.replace(/"/g, "'")}"`
    );
    return { ok: true, providerRef: `log:${notification.id}` };
  }
}

const LOG_CHANNEL = new LogDeliveryChannel();

/**
 * Resolve the active adapter for a notification's channel.
 *
 * PENDING PROVIDER CONFIG: the external comms provider (email/SMS/
 * WhatsApp) is a separate, undecided business choice — until it is
 * made every channel (WHATSAPP/WEB_PUSH/EMAIL) routes to the log
 * adapter. Register real adapters here once configured.
 */
export function getDeliveryChannel(_channel: string): DeliveryChannel {
  return LOG_CHANNEL;
}

// ─────────────────────────────────────────────────────────────
// Single delivery attempt
// ─────────────────────────────────────────────────────────────

export type DeliveryOutcome = "sent" | "failed" | "skipped";

/**
 * Attempt one delivery of a PENDING notification and persist the result.
 *
 *   • success  → status SENT + sentAt + deliveredAt + deliveredVia +
 *                externalMessageId (providerRef), lastError cleared
 *   • failure  → attemptCount + 1, lastError (and errorMessage, for the
 *                ops UI) recorded; the row stays PENDING for the sweep
 *                to retry. When attemptCount reaches
 *                MAX_DELIVERY_ATTEMPTS the row is marked FAILED +
 *                failedAt (terminal — no further retries).
 *   • skipped  → the row was no longer PENDING at update time (read by
 *                the user, or delivered by a concurrent worker); the
 *                write is a no-op guarded by status: PENDING.
 *
 * Returns the outcome so callers (notify flow / sweep) can aggregate.
 */
export async function attemptNotificationDelivery(
  notification: Notification
): Promise<DeliveryOutcome> {
  const channel = getDeliveryChannel(notification.channel);

  let result: DeliveryResult;
  try {
    result = await channel.send(notification);
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const attemptCount = notification.attemptCount + 1;

  if (result.ok) {
    const now = new Date();
    const updated = await db.notification.updateMany({
      where: { id: notification.id, status: NotificationStatus.PENDING },
      data: {
        status: NotificationStatus.SENT,
        sentAt: now,
        deliveredAt: now,
        deliveredVia: channel.key,
        externalMessageId: result.providerRef ?? null,
        attemptCount,
        lastError: null,
        errorMessage: null,
      },
    });
    return updated.count > 0 ? "sent" : "skipped";
  }

  const errorText = result.error ?? "unknown delivery error";
  const exhausted = attemptCount >= MAX_DELIVERY_ATTEMPTS;
  const updated = await db.notification.updateMany({
    where: { id: notification.id, status: NotificationStatus.PENDING },
    data: {
      attemptCount,
      lastError: errorText,
      // errorMessage is the legacy field the ops notifications UI renders
      // for FAILED rows — keep it in sync with lastError.
      errorMessage: errorText,
      ...(exhausted
        ? { status: NotificationStatus.FAILED, failedAt: new Date() }
        : {}),
    },
  });
  return updated.count > 0 ? "failed" : "skipped";
}

// ─────────────────────────────────────────────────────────────
// Pending retry sweep (cron-driven)
// ─────────────────────────────────────────────────────────────

export interface NotificationSweepResult {
  /** Rows selected and worked on this pass. */
  processed: number;
  /** Rows transitioned PENDING → SENT this pass. */
  sent: number;
  /** Rows whose delivery failed this pass (stays PENDING, or FAILED at max attempts). */
  failed: number;
  /** Rows selected but not attempted/superseded (concurrent state change). */
  skipped: number;
}

/**
 * Process pending notifications: retry delivery for PENDING rows with
 * attemptCount < MAX_DELIVERY_ATTEMPTS, oldest first.
 *
 * Idempotent — rows already SENT/READ/FAILED are never selected, and
 * each row update is guarded by status: PENDING so overlapping calls
 * (60s cron tick + immediate delivery in the notify flow) cannot
 * double-deliver or clobber a READ state.
 *
 * Called by POST /api/ops/notifications/dispatch (ops-events cron,
 * 60s tick) — keep it fast: bounded batch, no external fan-out.
 */
export async function processPendingNotifications(
  limit = 50
): Promise<NotificationSweepResult> {
  const take = Math.max(1, Math.min(limit, 200));

  const pending = await db.notification.findMany({
    where: {
      status: NotificationStatus.PENDING,
      attemptCount: { lt: MAX_DELIVERY_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of pending) {
    const outcome = await attemptNotificationDelivery(notification);
    if (outcome === "sent") sent += 1;
    else if (outcome === "failed") failed += 1;
    else skipped += 1;
  }

  return { processed: pending.length, sent, failed, skipped };
}
