// ============================================================
// Anna.I — Event Emitter (Phase 2)
// Connects to the ops-events WebSocket service as a client
// and emits events that get broadcast to all ops dashboards
// and optionally to specific household rooms.
// Fire-and-forget pattern — errors are logged, never thrown.
// ============================================================

import { io, Socket } from "socket.io-client";

// ─────────────────────────────────────────────────────────────
// Feature gate: only connect when OPS_EVENTS_URL is explicitly set.
// When not configured (e.g. Railway without ops-events service),
// the module disables itself silently — no retry storms, no log spam.
// ─────────────────────────────────────────────────────────────

const EVENTS_DISABLED = !process.env.OPS_EVENTS_URL;

if (EVENTS_DISABLED && typeof window === "undefined") {
  console.log(
    "[events] ops-events is DISABLED — OPS_EVENTS_URL is not set. " +
    "Event emissions will be no-ops. Set OPS_EVENTS_URL to the ops-events service URL to enable real-time WebSocket events."
  );
}

const OPS_EVENTS_URL = process.env.OPS_EVENTS_URL!; // only read when EVENTS_DISABLED is false

// ─────────────────────────────────────────────────────────────
// Singleton socket.io client connection
// ─────────────────────────────────────────────────────────────

let socket: Socket | null = null;
let connecting = false;
// Buffer of events emitted before the socket connected. These are flushed
// once the connection establishes, so the very first events after a cold
// server start are no longer silently dropped.
const pendingEmits: OpsEventPayload[] = [];

function getSocket(): Socket | null {
  if (EVENTS_DISABLED) return null;
  if (socket?.connected) return socket;

  if (!socket && !connecting) {
    connecting = true;
    try {
      socket = io(OPS_EVENTS_URL, {
        path: "/",
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        timeout: 5000,
        auth: { type: "event_source" },
      });

      socket.on("connect", () => {
        connecting = false;
        console.log("[events] Connected to ops-events service");
        // Flush any events that were buffered while we were connecting
        if (pendingEmits.length > 0) {
          console.log(`[events] Flushing ${pendingEmits.length} buffered event(s)`);
          for (const evt of pendingEmits) {
            socket!.emit("event:emit", {
              type: evt.type,
              data: evt.data,
              timestamp: evt.timestamp || new Date().toISOString(),
            });
          }
          pendingEmits.length = 0;
        }
      });

      socket.on("disconnect", () => {
        connecting = false;
      });

      socket.on("connect_error", (err) => {
        connecting = false;
        console.warn("[events] Failed to connect to ops-events:", err.message);
      });
    } catch (err) {
      connecting = false;
      console.warn("[events] Failed to create socket:", err);
    }
  }

  return socket?.connected ? socket : null;
}

// Eagerly initiate the connection on module load so the first emit doesn't
// have to wait for a connection round-trip. Safe to call multiple times.
// Only runs when OPS_EVENTS_URL is explicitly configured.
if (typeof window === "undefined" && !EVENTS_DISABLED) {
  // Server-side only — don't run on the client bundle
  getSocket();
}

// ─────────────────────────────────────────────────────────────
// Event Types
// ─────────────────────────────────────────────────────────────

export interface OpsEventPayload {
  type: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

// ─────────────────────────────────────────────────────────────
// Core emitter — fire-and-forget via WebSocket
// ─────────────────────────────────────────────────────────────

export async function emitOpsEvent(event: OpsEventPayload): Promise<void> {
  // When ops-events is disabled, silently drop all events (no-op).
  if (EVENTS_DISABLED) return;

  const s = getSocket();

  const payload = {
    type: event.type,
    data: event.data,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  if (!s) {
    // Socket not yet connected — buffer the event so it can be flushed
    // once the connection establishes. Caps at 50 events to avoid
    // unbounded memory growth if the ops-events service is down.
    if (pendingEmits.length < 50) {
      pendingEmits.push(payload);
    } else {
      console.warn(`[events] Buffer full, dropping event: ${event.type}`);
    }
    return;
  }

  try {
    s.emit("event:emit", payload);
  } catch (err) {
    // Fire-and-forget: log but never throw
    console.warn(`[events] Failed to emit ${event.type}:`, err);
  }
}

// ─────────────────────────────────────────────────────────────
// Convenience helpers — include householdId for room routing
// ─────────────────────────────────────────────────────────────

/** Anomaly detected and persisted */
export async function emitAnomalyDetected(anomaly: {
  id: string;
  type: string;
  severity: string;
  message: string;
  householdId: string;
  vendorId?: string;
  taskId?: string;
  bookingId?: string;
  metadata?: Record<string, unknown>;
}) {
  return emitOpsEvent({
    type: "anomaly:detected",
    data: anomaly,
  });
}

/** Notification created (from anomaly bridge or other source) */
export async function emitNotificationCreated(notification: {
  id: string;
  eventType: string;
  title: string;
  body: string;
  householdId?: string;
  householdName?: string;
  severity?: string;
}) {
  return emitOpsEvent({
    type: "notification:created",
    data: notification,
  });
}

/** Task status changed */
export async function emitTaskStatusChanged(task: {
  id: string;
  category: string;
  status: string;
  previousStatus: string;
  householdId: string;
  scheduledStart?: string;
}) {
  return emitOpsEvent({
    type: "task:status_changed",
    data: task,
  });
}

/** Booking status changed */
export async function emitBookingStatusChanged(booking: {
  id: string;
  status: string;
  previousStatus: string;
  vendorName?: string;
  vendorId?: string;          // ← NEW: routes to vendor room
  householdId?: string;
  householdName?: string;
  category: string;
}) {
  return emitOpsEvent({
    type: "booking:status_changed",
    data: booking,
  });
}

/** Escrow state changed — routes to specific household + vendor rooms */
export async function emitEscrowStateChanged(escrow: {
  id: string;
  state: string;
  previousState: string;
  amountCents: number;
  category: string;
  householdId: string;
  householdName?: string;
  vendorId?: string;            // ← NEW: routes to vendor room
  vendorPayoutCents?: number;
  disputeReason?: string;
  disputeResolution?: string;
}) {
  return emitOpsEvent({
    type: "escrow:state_changed",
    data: escrow,
  });
}

/** Autonomy level promoted — routes to specific household room */
export async function emitAutonomyPromoted(data: {
  householdId: string;
  householdName?: string;
  category: string;
  previousLevel: number;
  newLevel: number;
}) {
  return emitOpsEvent({
    type: "autonomy:promoted",
    data,
  });
}

/** Dispute raised — routes to specific household + vendor rooms */
export async function emitDisputeRaised(data: {
  taskId: string;
  householdId: string;
  householdName?: string;
  vendorId?: string;            // ← NEW: routes to vendor room
  category: string;
  reason: string;
  escrowAmountCents: number;
}) {
  return emitOpsEvent({
    type: "dispute:raised",
    data,
  });
}

/** Dispute resolved — routes to specific household + vendor rooms */
export async function emitDisputeResolved(data: {
  taskId: string;
  householdId: string;
  householdName?: string;
  vendorId?: string;            // ← NEW: routes to vendor room
  category: string;
  resolution: string;     // "dismissed" | "refunded"
  escrowAmountCents?: number;
  vendorPayoutCents?: number;
}) {
  return emitOpsEvent({
    type: "dispute:resolved",
    data,
  });
}

/** Vendor completed work — routes to specific household + vendor rooms */
export async function emitWorkCompleted(data: {
  taskId: string;
  bookingId: string;
  householdId: string;
  category: string;
  vendorId?: string;            // ← NEW: routes to vendor room
  vendorName?: string;
  hasPhotos: boolean;
  completionNotes?: string;
}) {
  return emitOpsEvent({
    type: "work:completed",
    data,
  });
}

/** Photos uploaded by vendor — routes to specific household + vendor rooms */
export async function emitPhotosUploaded(data: {
  taskId: string;
  bookingId: string;
  householdId: string;
  category: string;
  vendorId?: string;            // ← NEW: routes to vendor room
  photoCount: number;
}) {
  return emitOpsEvent({
    type: "photos:uploaded",
    data,
  });
}

// ─────────────────────────────────────────────────────────────
// Vendor-specific event helpers
// ─────────────────────────────────────────────────────────────

/**
 * Vendor notification created — routes to the vendor room.
 * Use this whenever a notification with recipientType=VENDOR is
 * created in the DB. The vendor portal listens on `vendor:event`
 * and invalidates its notification cache + shows a toast.
 */
export async function emitVendorNotification(data: {
  vendorId: string;
  notificationId: string;
  eventType: string;
  title: string;
  body: string;
  referenceType?: string | null;
  referenceId?: string | null;
  householdId?: string;
  category?: string;
}) {
  return emitOpsEvent({
    type: "vendor:notification",
    data,
  });
}

/** Task dispatched to vendor (new booking opportunity) — routes to vendor room */
export async function emitTaskDispatched(data: {
  taskId: string;
  bookingId: string;
  vendorId: string;
  householdId: string;
  category: string;
  scheduledStart?: string;
  responseDeadline?: string;
}) {
  return emitOpsEvent({
    type: "task:dispatched",
    data,
  });
}
