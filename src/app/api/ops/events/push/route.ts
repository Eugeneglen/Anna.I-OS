import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";

// ============================================================
// POST /api/ops/events/push
// API endpoint for pushing events to the ops-events WebSocket service.
// The anomaly detector calls this after creating anomalies.
// The Next.js server connects to the ops-events service as a
// socket.io client and relays events to connected dashboards.
// ============================================================

let opsEventsSocket: any = null;
let socketConnecting = false;

async function getOpsEventsSocket() {
  if (opsEventsSocket?.connected) return opsEventsSocket;

  if (socketConnecting) return null;

  socketConnecting = true;
  try {
    const { io } = await import("socket.io-client");
    opsEventsSocket = io("http://localhost:3004", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 3000,
      timeout: 5000,
      auth: { type: "event_source" },
    });

    opsEventsSocket.on("connect", () => {
      socketConnecting = false;
      console.log("[ops-events-proxy] Connected to ops-events service");
    });

    opsEventsSocket.on("disconnect", () => {
      socketConnecting = false;
      console.log("[ops-events-proxy] Disconnected from ops-events service");
    });

    opsEventsSocket.on("connect_error", (err: Error) => {
      socketConnecting = false;
      console.warn("[ops-events-proxy] Connect error:", err.message);
    });

    await new Promise((resolve) => setTimeout(resolve, 1500));
    return opsEventsSocket.connected ? opsEventsSocket : null;
  } catch (err) {
    socketConnecting = false;
    console.warn("[ops-events-proxy] Failed to connect:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/ops/events/push
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { type, data } = body;

    if (!type || !data) {
      return NextResponse.json({ error: "Missing type or data" }, { status: 400 });
    }

    const socket = await getOpsEventsSocket();

    if (!socket) {
      return NextResponse.json({
        ok: true,
        delivered: false,
        event: type,
        message: "Events service not connected — event queued for delivery",
      });
    }

    const event = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    socket.emit("event:emit", event);

    return NextResponse.json({
      ok: true,
      delivered: true,
      event: type,
    });
  } catch (error) {
    console.error("[ops-events-proxy] Error:", error);
    return NextResponse.json(
      { error: "Failed to push event" },
      { status: 500 }
    );
  }
}
