import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─────────────────────────────────────────────────────────────
// Client tracking
// ─────────────────────────────────────────────────────────────

const clients = new Map<string, {
  id: string;
  type: string;           // "ops_dashboard" | "household" | "event_source"
  householdId?: string;   // Only for household clients
  joinedAt: number;
}>();

function getOnlineCount(): number {
  return clients.size;
}

function getHouseholdClients(householdId: string): number {
  let count = 0;
  for (const client of clients.values()) {
    if (client.type === "household" && client.householdId === householdId) {
      count++;
    }
  }
  return count;
}

// ─────────────────────────────────────────────────────────────
// Connection handling
// ─────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  const type = (socket.handshake.auth?.type as string) || "client";
  const householdId = (socket.handshake.auth?.householdId as string) || undefined;

  console.log(`[ops-events] ${type} connected: ${socket.id}${householdId ? ` (household: ${householdId})` : ""}`);

  // Register client
  clients.set(socket.id, {
    id: socket.id,
    type,
    householdId,
    joinedAt: Date.now(),
  });

  // Auto-join household room if householdId provided
  if (type === "household" && householdId) {
    socket.join(`household:${householdId}`);
    console.log(`[ops-events] ${socket.id} joined room: household:${householdId}`);
  }

  // Send ops dashboard initial data
  if (type === "ops_dashboard") {
    socket.emit("events:recent", []);
  }

  // Broadcast online count
  io.emit("ops:online", { count: getOnlineCount() });

  // ── Room management ──

  socket.on("join:household", (data: { householdId: string }) => {
    if (!data?.householdId) return;
    const newRoom = `household:${data.householdId}`;

    // Leave old room if switching
    const client = clients.get(socket.id);
    if (client?.householdId && client.householdId !== data.householdId) {
      socket.leave(`household:${client.householdId}`);
      console.log(`[ops-events] ${socket.id} left room: household:${client.householdId}`);
    }

    socket.join(newRoom);
    if (client) {
      client.householdId = data.householdId;
    }
    console.log(`[ops-events] ${socket.id} joined room: ${newRoom}`);

    // Confirm join
    socket.emit("household:joined", { householdId: data.householdId });
  });

  socket.on("leave:household", () => {
    const client = clients.get(socket.id);
    if (client?.householdId) {
      socket.leave(`household:${client.householdId}`);
      console.log(`[ops-events] ${socket.id} left room: household:${client.householdId}`);
      client.householdId = undefined;
    }
  });

  // ── Event relay (from event_source → broadcast) ──

  socket.on("event:emit", (event: { type: string; data: Record<string, unknown>; timestamp: string }) => {
    if (!event?.type) return;
    console.log(`[ops-events] Broadcasting: ${event.type}`);

    // Broadcast to ALL connected clients (ops dashboards)
    io.emit("event", event);
    io.emit(`event:${event.type}`, event);

    // If event has a householdId, also send to that household room
    const targetHouseholdId = event.data?.householdId as string | undefined;
    if (targetHouseholdId) {
      io.to(`household:${targetHouseholdId}`).emit("household:event", event);
      io.to(`household:${targetHouseholdId}`).emit(`household:event:${event.type}`, event);
      console.log(`[ops-events] Routed ${event.type} to household:${targetHouseholdId} (${getHouseholdClients(targetHouseholdId)} clients)`);
    }
  });

  // ── Heartbeat from household clients ──
  socket.on("household:ping", (data: { householdId: string }) => {
    socket.emit("household:pong", {
      householdId: data?.householdId,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Disconnect ──

  socket.on("disconnect", () => {
    clients.delete(socket.id);
    io.emit("ops:online", { count: getOnlineCount() });
    console.log(`[ops-events] Disconnected: ${socket.id}. Online: ${getOnlineCount()}`);
  });
});

// ─────────────────────────────────────────────────────────────
// Predictive Lock Cron
// Every 15 minutes, call the predictive lock endpoint
// to transition overdue PREDICTED tasks → CREATED + auto-dispatch
// ─────────────────────────────────────────────────────────────

const PREDICTIVE_LOCK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PREDICTIVE_LOCK_CRON_DELAY = 30 * 1000; // wait 30s after startup

async function runPredictiveLock() {
  try {
    const res = await fetch("http://localhost:3000/api/predictive/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (res.ok && data.lockedCount > 0) {
      console.log(`[cron] Predictive lock: ${data.lockedCount} task(s) locked and dispatched`);
    }
  } catch (err) {
    // Non-critical — Next.js may not be up yet during startup
    console.warn("[cron] Predictive lock check failed (non-critical):", err instanceof Error ? err.message : err);
  }
}

// Schedule recurring lock check
setTimeout(() => {
  console.log(`[cron] Predictive lock scheduler active (every ${PREDICTIVE_LOCK_INTERVAL_MS / 60000}min)`);
  runPredictiveLock(); // Run immediately on first schedule
  setInterval(runPredictiveLock, PREDICTIVE_LOCK_INTERVAL_MS);
}, PREDICTIVE_LOCK_CRON_DELAY);

// ─────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────

httpServer.listen(3004, () => {
  console.log(`[ops-events] Listening on ${3004}`);
});
