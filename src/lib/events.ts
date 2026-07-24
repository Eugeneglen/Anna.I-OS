// ============================================================
// Anna.I — Event Emitter (Phase 2)
// Connects to the ops-events WebSocket service as a client
// and emits events that get broadcast to all ops dashboards
// and optionally to specific household rooms.
// Fire-and-forget pattern — errors are logged, never thrown.
// ============================================================

import { io, Socket } from "socket.io-client";

const OPS_EVENTS_URL = process.env.OPS_EVENTS_URL || "http://localhost:3004";

// ─────────────────────────────────────────────────────────────
// Singleton socket.io client connection
// ─────────────────────────────────────────────────────────────

let socket: Socket | null = null;
let connecting = false;

function getSocket(): Socket | null {
  if (socket?.connected) return socket;

  if (!socket && !connecting) {
    connecting = true;
    try {
      socket = io(OPS_EVENTS_URL, {
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
  const s = getSocket();
  if (!s) {
    // Service not available — silently skip (fire-and-forget)
    return;
  }

  const payload = {
    type: event.type,
    data: event.data,
    timestamp: event.timestamp || new Date().toISOString(),
  };

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
  householdId?: string;
  householdName?: string;
  category: string;
}) {
  return emitOpsEvent({
    type: "booking:status_changed",
    data: booking,
  });
}

/** Escrow state changed — routes to specific household room */
export async function emitEscrowStateChanged(escrow: {
  id: string;
  state: string;
  previousState: string;
  amountCents: number;
  category: string;
  householdId: string;
  householdName?: string;
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

/** Dispute raised — routes to specific household room */
export async function emitDisputeRaised(data: {
  taskId: string;
  householdId: string;
  householdName?: string;
  category: string;
  reason: string;
  escrowAmountCents: number;
}) {
  return emitOpsEvent({
    type: "dispute:raised",
    data,
  });
}

/** Dispute resolved — routes to specific household room */
export async function emitDisputeResolved(data: {
  taskId: string;
  householdId: string;
  householdName?: string;
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

/** Vendor completed work — routes to specific household room */
export async function emitWorkCompleted(data: {
  taskId: string;
  bookingId: string;
  householdId: string;
  category: string;
  vendorName?: string;
  hasPhotos: boolean;
  completionNotes?: string;
}) {
  return emitOpsEvent({
    type: "work:completed",
    data,
  });
}

/** Photos uploaded by vendor — routes to specific household room */
export async function emitPhotosUploaded(data: {
  taskId: string;
  bookingId: string;
  householdId: string;
  category: string;
  photoCount: number;
}) {
  return emitOpsEvent({
    type: "photos:uploaded",
    data,
  });
}
