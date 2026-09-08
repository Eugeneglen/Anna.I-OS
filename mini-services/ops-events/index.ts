// ============================================================
// Anna.I — ops-events WebSocket service (hardened, audit FIX-1b)
//
// Security model (fixes AUDIT-1b/1d realtime findings):
//   • Every connection is authenticated at the handshake:
//       1. auth.serverToken === OPS_EVENT_SERVER_SECRET  → trusted
//          server (the Next.js app server, src/lib/events.ts).
//       2. Portal session cookies (household_token / vendor_token /
//          ops_token) forwarded on the handshake — the browser reaches
//          this service same-origin through the Caddy gateway
//          (/?XTransformPort=3004), so cookies ARE sent. Verified with
//          jose against the matching portal JWT secret.
//       3. auth.token — short-lived JWT issued by GET /api/events/token
//          (fallback for contexts where cookies are unavailable).
//     Connections without any valid credential are REJECTED.
//   • Rooms are assigned from the VERIFIED identity, never from
//     client-declared ids. join:household / join:vendor requests are
//     refused unless the token matches the requested room (or the
//     socket is a trusted server).
//   • event:emit is accepted ONLY from trusted-server sockets — this
//     kills event spoofing from browsers.
//   • Broadcast hygiene: ops events go to the "ops" room (ops-role
//     sockets + trusted server) only; household/vendor payloads go
//     ONLY to their addressed rooms. No more blanket io.emit to every
//     client (cross-household leak).
//
// Operational automation (cron timers, all authenticated with the
// shared CRON_SECRET header):
//   • Predictive lock (existing, 15 min)
//   • Voucher issuance dispatch (existing, 60 s)
//   • Voucher expiry sweep (existing, 60 s)
//   • Booking timeout sweeper → /api/tasks/timeout-check (NEW, 60 s)
//   • Anomaly sweep → /api/anomalies/check (NEW, 60 s)
//   • Notification dispatch → /api/ops/notifications/dispatch (NEW, 60 s)
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { timingSafeEqual } from "crypto";
import { Server } from "socket.io";
import { jwtVerify, type JWTPayload } from "jose";

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

// This service runs with the MAIN project env loaded (see package.json:
// `bun --hot --env-file=../../.env index.ts`), so it shares the exact
// CRON_SECRET / OPS_EVENT_SERVER_SECRET / portal JWT secrets that the
// Next.js app reads. No secrets are duplicated in this file.
const PORT = 3004; // fixed — the Caddy gateway routes XTransformPort=3004 here

const OPS_EVENT_SERVER_SECRET = process.env.OPS_EVENT_SERVER_SECRET || "";
const HOUSEHOLD_JWT_SECRET = process.env.HOUSEHOLD_JWT_SECRET || "";
const VENDOR_JWT_SECRET = process.env.VENDOR_JWT_SECRET || "";
const OPS_JWT_SECRET = process.env.OPS_JWT_SECRET || "";
const CRON_SECRET = process.env.CRON_SECRET || "anna-cron-dev-secret"; // must match the Next.js routes' dev fallback

const householdSecret = HOUSEHOLD_JWT_SECRET ? new TextEncoder().encode(HOUSEHOLD_JWT_SECRET) : null;
const vendorSecret = VENDOR_JWT_SECRET ? new TextEncoder().encode(VENDOR_JWT_SECRET) : null;
const opsSecret = OPS_JWT_SECRET ? new TextEncoder().encode(OPS_JWT_SECRET) : null;

if (!OPS_EVENT_SERVER_SECRET || !householdSecret || !vendorSecret || !opsSecret) {
  console.warn(
    "[ops-events] WARNING: one or more auth secrets are unset — the matching " +
      "auth paths are disabled until the env file is loaded."
  );
}

/** Ops broadcast room: ops-role sockets + the trusted server. */
const OPS_ROOM = "ops";

// ─────────────────────────────────────────────────────────────
// Identity types
// ─────────────────────────────────────────────────────────────

type SocketRole = "household" | "vendor" | "ops" | "server";

interface SocketIdentity {
  role: SocketRole;
  /** Trusted server connection (Next.js app server). May emit events. */
  trusted: boolean;
  householdId?: string;
  memberId?: string;
  vendorId?: string;
  vendorUserId?: string;
  opsUserId?: string;
}

// ─────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) {
    // Still do a comparison to keep timing roughly constant.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

async function tryVerifyJwt(token: string, secret: Uint8Array): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Verify a portal session cookie (same JWTs the Next.js app issues). */
async function verifyCookieIdentity(
  cookieName: string,
  secret: Uint8Array | null,
  token: string
): Promise<SocketIdentity | null> {
  if (!secret) return null;
  const payload = await tryVerifyJwt(token, secret);
  if (!payload) return null;
  if (cookieName === "household_token") {
    const householdId = asString(payload.householdId);
    if (!householdId) return null;
    return { role: "household", trusted: false, householdId, memberId: asString(payload.memberId) };
  }
  if (cookieName === "vendor_token") {
    const vendorId = asString(payload.vendorId);
    if (!vendorId) return null;
    return { role: "vendor", trusted: false, vendorId, vendorUserId: asString(payload.userId) };
  }
  // ops_token
  const opsUserId = asString(payload.userId);
  if (!opsUserId) return null;
  return { role: "ops", trusted: false, opsUserId };
}

/**
 * Verify a short-lived event token issued by GET /api/events/token.
 * The token is signed with exactly ONE portal secret — classification is
 * bound to the secret that verifies it (never to self-declared fields),
 * and the role claim must match that secret.
 */
async function verifyEventToken(token: string): Promise<SocketIdentity | null> {
  if (householdSecret) {
    const p = await tryVerifyJwt(token, householdSecret);
    if (p && p.role === "household" && asString(p.householdId)) {
      return { role: "household", trusted: false, householdId: asString(p.householdId), memberId: asString(p.memberId) };
    }
  }
  if (vendorSecret) {
    const p = await tryVerifyJwt(token, vendorSecret);
    if (p && p.role === "vendor" && asString(p.vendorId)) {
      return { role: "vendor", trusted: false, vendorId: asString(p.vendorId), vendorUserId: asString(p.userId) };
    }
  }
  if (opsSecret) {
    const p = await tryVerifyJwt(token, opsSecret);
    if (p && p.role === "ops" && asString(p.userId)) {
      return { role: "ops", trusted: false, opsUserId: asString(p.userId) };
    }
  }
  return null;
}

// Portal cookies, in fallback order. The client's auth.type hint (which
// portal the socket belongs to) is used to SELECT which cookie to verify
// first — the signature check itself is the actual gate, so the hint
// cannot grant any privilege, it only disambiguates browsers that hold
// cookies for more than one portal.
const PORTAL_COOKIES: { type: string; cookie: string; secret: Uint8Array | null }[] = [
  { type: "household", cookie: "household_token", secret: householdSecret },
  { type: "vendor", cookie: "vendor_token", secret: vendorSecret },
  { type: "ops", cookie: "ops_token", secret: opsSecret },
];

// ─────────────────────────────────────────────────────────────
// HTTP server + socket.io
// ─────────────────────────────────────────────────────────────

// NOTE on plain HTTP routes: socket.io is attached with path "/", so
// engine.io's request interception matches EVERY url (see engine.io's
// attach check). Plain handlers on this server are therefore never
// reached — the health endpoint below is registered as an ENGINE
// middleware instead, which runs before the engine processes a request.
const httpServer = createServer();

const io = new Server(httpServer, {
  path: "/",
  // CORS stays permissive because the sandbox preview origin varies per
  // session. Access is now gated by AUTH, not origin: an unauthenticated
  // handshake is rejected before any room join or event can flow.
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Plain HTTP health probe (open by design — returns no data). Engine
// middlewares run for every intercepted request BEFORE the transport
// handshake, so this works even though engine.io owns path "/".
io.engine.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
  try {
    const pathname = (req.url || "/").split("?")[0];
    const isUpgrade = (req.headers.connection || "").toLowerCase().includes("upgrade");
    if (req.method === "GET" && !isUpgrade && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "ops-events", port: PORT }));
      return; // answered — do not continue into the engine handshake
    }
  } catch {
    // fall through to next()
  }
  next();
});

// ─────────────────────────────────────────────────────────────
// Handshake authentication middleware
// ─────────────────────────────────────────────────────────────

io.use(async (socket, next) => {
  const auth = (socket.handshake.auth || {}) as Record<string, unknown>;

  // 1) Trusted server connection (the Next.js app via src/lib/events.ts)
  const serverToken = typeof auth.serverToken === "string" ? auth.serverToken : "";
  if (serverToken && OPS_EVENT_SERVER_SECRET && secretsMatch(serverToken, OPS_EVENT_SERVER_SECRET)) {
    socket.data.identity = { role: "server", trusted: true } satisfies SocketIdentity;
    next();
    return;
  }

  // 2) Portal session cookies on the handshake (same-origin through the
  //    gateway, so the browser forwards them on the websocket upgrade).
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const claimedType = typeof auth.type === "string" ? auth.type : "";
  const ordered = [
    ...PORTAL_COOKIES.filter((p) => p.type === claimedType),
    ...PORTAL_COOKIES.filter((p) => p.type !== claimedType),
  ];
  for (const portal of ordered) {
    const token = cookies[portal.cookie];
    if (!token || !portal.secret) continue;
    const identity = await verifyCookieIdentity(portal.cookie, portal.secret, token);
    if (identity) {
      socket.data.identity = identity;
      next();
      return;
    }
  }

  // 3) Short-lived event token (fallback when cookies are unavailable)
  const eventToken = typeof auth.token === "string" ? auth.token : "";
  if (eventToken) {
    const identity = await verifyEventToken(eventToken);
    if (identity) {
      socket.data.identity = identity;
      next();
      return;
    }
  }

  console.warn(
    `[ops-events] Connection rejected (no valid credentials): remote=${socket.handshake.address}` +
      (claimedType ? ` claimedType=${claimedType}` : "")
  );
  next(new Error("unauthorized: missing or invalid credentials"));
});

// ─────────────────────────────────────────────────────────────
// Client tracking
// ─────────────────────────────────────────────────────────────

const clients = new Map<
  string,
  {
    id: string;
    role: SocketRole;
    householdId?: string; // verified household identity (household role only)
    vendorId?: string;    // verified vendor identity (vendor role only)
    joinedAt: number;
  }
>();

function getOnlineCount(): number {
  return clients.size;
}

function getHouseholdClients(householdId: string): number {
  let count = 0;
  for (const client of clients.values()) {
    if (client.role === "household" && client.householdId === householdId) {
      count++;
    }
  }
  return count;
}

function getVendorClients(vendorId: string): number {
  let count = 0;
  for (const client of clients.values()) {
    if (client.role === "vendor" && client.vendorId === vendorId) {
      count++;
    }
  }
  return count;
}

// ─────────────────────────────────────────────────────────────
// Connection handling
// ─────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  const identity = (socket.data.identity || {}) as SocketIdentity;

  console.log(
    `[ops-events] ${identity.role} connected: ${socket.id}` +
      (identity.householdId ? ` (household: ${identity.householdId})` : "") +
      (identity.vendorId ? ` (vendor: ${identity.vendorId})` : "") +
      (identity.trusted ? " (trusted server)" : "")
  );

  clients.set(socket.id, {
    id: socket.id,
    role: identity.role,
    householdId: identity.householdId,
    vendorId: identity.vendorId,
    joinedAt: Date.now(),
  });

  // Auto-join rooms based on the VERIFIED identity (never client claims):
  if (identity.role === "household" && identity.householdId) {
    socket.join(`household:${identity.householdId}`);
  }
  if (identity.role === "vendor" && identity.vendorId) {
    socket.join(`vendor:${identity.vendorId}`);
  }
  // Ops broadcast room: ops-role sockets + the trusted server.
  if (identity.role === "ops" || identity.role === "server") {
    socket.join(OPS_ROOM);
  }

  // Send ops dashboards their (empty) initial catch-up payload
  if (identity.role === "ops") {
    socket.emit("events:recent", []);
  }

  // Broadcast online count to the ops dashboards only
  io.to(OPS_ROOM).emit("ops:online", { count: getOnlineCount() });

  // ── Room management: household ──
  // household:<id> requires a household token whose householdId matches,
  // OR a trusted server connection. Anything else is refused and logged.

  socket.on("join:household", (data: { householdId: string }) => {
    if (!data?.householdId) return;

    const allowed =
      identity.trusted ||
      (identity.role === "household" && identity.householdId === data.householdId);
    if (!allowed) {
      console.warn(
        `[ops-events] REFUSED join:household ${data.householdId} from ${socket.id} ` +
          `(role=${identity.role}, verified household=${identity.householdId ?? "none"})`
      );
      return;
    }

    // Leave old room if switching (relevant for trusted server sockets)
    const client = clients.get(socket.id);
    if (client?.householdId && client.householdId !== data.householdId) {
      socket.leave(`household:${client.householdId}`);
      console.log(`[ops-events] ${socket.id} left room: household:${client.householdId}`);
    }

    socket.join(`household:${data.householdId}`);
    if (client) {
      client.householdId = data.householdId;
    }
    console.log(`[ops-events] ${socket.id} joined room: household:${data.householdId}`);

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

  // ── Room management: vendor ──
  // vendor:<id> requires a vendor token whose vendorId matches, OR a
  // trusted server connection. Anything else is refused and logged.

  socket.on("join:vendor", (data: { vendorId: string }) => {
    if (!data?.vendorId) return;

    const allowed =
      identity.trusted ||
      (identity.role === "vendor" && identity.vendorId === data.vendorId);
    if (!allowed) {
      console.warn(
        `[ops-events] REFUSED join:vendor ${data.vendorId} from ${socket.id} ` +
          `(role=${identity.role}, verified vendor=${identity.vendorId ?? "none"})`
      );
      return;
    }

    // Leave old room if switching (relevant for trusted server sockets)
    const client = clients.get(socket.id);
    if (client?.vendorId && client.vendorId !== data.vendorId) {
      socket.leave(`vendor:${client.vendorId}`);
      console.log(`[ops-events] ${socket.id} left room: vendor:${client.vendorId}`);
    }

    socket.join(`vendor:${data.vendorId}`);
    if (client) {
      client.vendorId = data.vendorId;
    }
    console.log(`[ops-events] ${socket.id} joined room: vendor:${data.vendorId}`);

    socket.emit("vendor:joined", { vendorId: data.vendorId });
  });

  socket.on("leave:vendor", () => {
    const client = clients.get(socket.id);
    if (client?.vendorId) {
      socket.leave(`vendor:${client.vendorId}`);
      console.log(`[ops-events] ${socket.id} left room: vendor:${client.vendorId}`);
      client.vendorId = undefined;
    }
  });

  // ── Event relay (trusted server → rooms) ──
  // Only the Next.js app server (authenticated with OPS_EVENT_SERVER_SECRET)
  // may emit events. All browser sockets are rejected — this kills the
  // event-spoofing hole.

  socket.on("event:emit", (event: { type: string; data: Record<string, unknown>; timestamp: string }) => {
    if (!identity.trusted) {
      console.warn(
        `[ops-events] REJECTED event:emit from untrusted socket ${socket.id} (role=${identity.role})`
      );
      return;
    }
    if (!event?.type) return;
    console.log(`[ops-events] Relaying: ${event.type}`);

    // Ops dashboards: targeted emit to the ops broadcast room only —
    // NEVER a blanket io.emit (that was the cross-household leak).
    io.to(OPS_ROOM).emit("event", event);
    io.to(OPS_ROOM).emit(`event:${event.type}`, event);

    // If the event addresses a household, send it ONLY to that room.
    const targetHouseholdId = asString(event.data?.householdId);
    if (targetHouseholdId) {
      io.to(`household:${targetHouseholdId}`).emit("household:event", event);
      io.to(`household:${targetHouseholdId}`).emit(`household:event:${event.type}`, event);
      console.log(
        `[ops-events] Routed ${event.type} to household:${targetHouseholdId} (${getHouseholdClients(targetHouseholdId)} clients)`
      );
    }

    // If the event addresses a vendor, send it ONLY to that room.
    const targetVendorId = asString(event.data?.vendorId);
    if (targetVendorId) {
      io.to(`vendor:${targetVendorId}`).emit("vendor:event", event);
      io.to(`vendor:${targetVendorId}`).emit(`vendor:event:${event.type}`, event);
      console.log(
        `[ops-events] Routed ${event.type} to vendor:${targetVendorId} (${getVendorClients(targetVendorId)} clients)`
      );
    }
  });

  // ── Heartbeat from household clients ──
  socket.on("household:ping", (data: { householdId: string }) => {
    socket.emit("household:pong", {
      householdId: data?.householdId,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Heartbeat from vendor clients ──
  socket.on("vendor:ping", (data: { vendorId: string }) => {
    socket.emit("vendor:pong", {
      vendorId: data?.vendorId,
      timestamp: new Date().toISOString(),
    });
  });

  // ── Disconnect ──
  socket.on("disconnect", () => {
    clients.delete(socket.id);
    io.to(OPS_ROOM).emit("ops:online", { count: getOnlineCount() });
    console.log(`[ops-events] Disconnected: ${socket.id}. Online: ${getOnlineCount()}`);
  });
});

// ─────────────────────────────────────────────────────────────
// Cron helper — log an outcome only when it CHANGES so tolerated
// failures (401 while a route's guard lands, 404 while a parallel
// agent ships a route) don't spam the log every 60 s tick.
// ─────────────────────────────────────────────────────────────

const cronOutcomeLog = new Map<string, string>();

function logCronOutcome(name: string, outcome: string): void {
  if (cronOutcomeLog.get(name) === outcome) return;
  cronOutcomeLog.set(name, outcome);
  if (outcome === "ok") {
    console.log(`[cron] ${name}: endpoint responding`);
  } else {
    console.warn(`[cron] ${name}: ${outcome} (will keep retrying)`);
  }
}

const CRON_FETCH_TIMEOUT_MS = 20_000;

// ─────────────────────────────────────────────────────────────
// Predictive Lock Cron
// Every 15 minutes, call the predictive lock endpoint
// to transition overdue PREDICTED tasks → CREATED + auto-dispatch
// ─────────────────────────────────────────────────────────────

const PREDICTIVE_LOCK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PREDICTIVE_LOCK_CRON_DELAY = 30 * 1000; // wait 30s after startup
let predictiveLockInFlight = false;

async function runPredictiveLock() {
  if (predictiveLockInFlight) return;
  predictiveLockInFlight = true;
  try {
    const res = await fetch("http://localhost:3000/api/predictive/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      signal: AbortSignal.timeout(CRON_FETCH_TIMEOUT_MS),
    });
    const data: any = await res.json().catch(() => null);
    if (res.ok && data?.lockedCount > 0) {
      console.log(`[cron] Predictive lock: ${data.lockedCount} task(s) locked and dispatched`);
    }
  } catch (err) {
    // Non-critical — Next.js may not be up yet during startup
    console.warn("[cron] Predictive lock check failed (non-critical):", err instanceof Error ? err.message : err);
  } finally {
    predictiveLockInFlight = false;
  }
}

setTimeout(() => {
  console.log(`[cron] Predictive lock scheduler active (every ${PREDICTIVE_LOCK_INTERVAL_MS / 60000}min)`);
  runPredictiveLock(); // Run immediately on first schedule
  setInterval(runPredictiveLock, PREDICTIVE_LOCK_INTERVAL_MS);
}, PREDICTIVE_LOCK_CRON_DELAY);

// ─────────────────────────────────────────────────────────────
// Issuance Dispatcher Cron (F5/F6)
// Every 60 s, ask the Next.js app to process ONE pending
// VoucherIssuanceJob. Authenticated with the shared CRON_SECRET
// header — PENDING jobs now complete with zero browser tabs open.
// ─────────────────────────────────────────────────────────────

const ISSUANCE_DISPATCH_INTERVAL_MS = 60 * 1000; // 60 seconds
const ISSUANCE_DISPATCH_CRON_DELAY = 45 * 1000; // stagger vs predictive lock
let issuanceDispatchInFlight = false;

async function runIssuanceDispatch() {
  if (issuanceDispatchInFlight) return;
  issuanceDispatchInFlight = true;
  try {
    const res = await fetch("http://127.0.0.1:3000/api/ops/marketing/dispatch-issuance", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      signal: AbortSignal.timeout(CRON_FETCH_TIMEOUT_MS),
    });
    if (res.status === 204) return; // nothing pending — normal case
    const data: any = await res.json().catch(() => null);
    if (res.ok && data?.processed) {
      console.log(
        `[cron] Issuance dispatch: job ${data.jobId} → ${data.status}` +
          (data.status === "COMPLETED" ? ` (issued=${data.issued}, failed=${data.failedCount}, skipped=${data.skippedCount})` : ` error=${String(data.error).slice(0, 120)}`)
      );
    } else if (!res.ok && res.status !== 401) {
      console.warn(`[cron] Issuance dispatch returned ${res.status}`);
    }
  } catch (err) {
    // Non-critical — Next.js may not be up yet during startup
    console.warn("[cron] Issuance dispatch failed (non-critical):", err instanceof Error ? err.message : err);
  } finally {
    issuanceDispatchInFlight = false;
  }
}

setTimeout(() => {
  console.log(`[cron] Issuance dispatcher active (every ${ISSUANCE_DISPATCH_INTERVAL_MS / 1000}s)`);
  runIssuanceDispatch();
  setInterval(runIssuanceDispatch, ISSUANCE_DISPATCH_INTERVAL_MS);
}, ISSUANCE_DISPATCH_CRON_DELAY);

// ─────────────────────────────────────────────────────────────
// Voucher Expiry Sweep Cron (F20)
// Every 60 s, ask the Next.js app to run the voucher expiry
// lifecycle pass: flip past-expiry CLAIMED vouchers → EXPIRED and
// send "expiring soon" reminders. Authenticated with the shared
// CRON_SECRET header — mirrors the issuance dispatcher above.
// ─────────────────────────────────────────────────────────────

const EXPIRY_DISPATCH_INTERVAL_MS = 60 * 1000; // 60 seconds
const EXPIRY_DISPATCH_CRON_DELAY = 55 * 1000; // stagger vs the other ticks
let expiryDispatchInFlight = false;

async function runExpiryDispatch() {
  if (expiryDispatchInFlight) return;
  expiryDispatchInFlight = true;
  try {
    const res = await fetch("http://127.0.0.1:3000/api/ops/marketing/dispatch-expiry", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      signal: AbortSignal.timeout(CRON_FETCH_TIMEOUT_MS),
    });
    if (res.status === 204) return; // nothing to expire or remind — normal case
    const data: any = await res.json().catch(() => null);
    if (res.ok && data && (data.expired > 0 || data.remindersSent > 0)) {
      console.log(
        `[cron] Voucher expiry sweep: ${data.expired} expired, ${data.remindersSent} reminder(s) sent`
      );
    } else if (!res.ok && res.status !== 401) {
      console.warn(`[cron] Voucher expiry sweep returned ${res.status}`);
    }
  } catch (err) {
    // Non-critical — Next.js may not be up yet during startup
    console.warn("[cron] Voucher expiry sweep failed (non-critical):", err instanceof Error ? err.message : err);
  } finally {
    expiryDispatchInFlight = false;
  }
}

setTimeout(() => {
  console.log(`[cron] Voucher expiry sweep active (every ${EXPIRY_DISPATCH_INTERVAL_MS / 1000}s)`);
  runExpiryDispatch();
  setInterval(runExpiryDispatch, EXPIRY_DISPATCH_INTERVAL_MS);
}, EXPIRY_DISPATCH_CRON_DELAY);

// ─────────────────────────────────────────────────────────────
// Booking Timeout Sweeper Cron (audit FIX: orphaned timeout-check)
// Every 60 s, POST /api/tasks/timeout-check with the shared cron
// secret. The route accepts EITHER an ops session (manual trigger
// from the console) OR the x-cron-secret header — this timer is the
// missing caller that was leaving expired MATCHING bookings stuck.
// ─────────────────────────────────────────────────────────────

const TIMEOUT_SWEEP_INTERVAL_MS = 60 * 1000; // 60 seconds
const TIMEOUT_SWEEP_CRON_DELAY = 20 * 1000; // stagger vs predictive lock
let timeoutSweepInFlight = false;

async function runTimeoutSweep() {
  if (timeoutSweepInFlight) return;
  timeoutSweepInFlight = true;
  try {
    const res = await fetch("http://localhost:3000/api/tasks/timeout-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      signal: AbortSignal.timeout(CRON_FETCH_TIMEOUT_MS),
    });
    if (res.status === 401) {
      logCronOutcome("timeout-sweep", "HTTP 401 — cron secret rejected");
      return;
    }
    logCronOutcome("timeout-sweep", "ok");
    const data: any = await res.json().catch(() => null);
    if (res.ok && data && typeof data.processed === "number" && data.processed > 0) {
      console.log(
        `[cron] Timeout sweep: checked ${data.checked ?? 0}, re-routed/escalated ${data.processed}`
      );
    }
  } catch (err) {
    // Non-critical — Next.js may not be up yet during startup
    console.warn("[cron] Timeout sweep failed (non-critical):", err instanceof Error ? err.message : err);
  } finally {
    timeoutSweepInFlight = false;

  }
}

setTimeout(() => {
  console.log(`[cron] Booking timeout sweeper active (every ${TIMEOUT_SWEEP_INTERVAL_MS / 1000}s)`);
  runTimeoutSweep();
  setInterval(runTimeoutSweep, TIMEOUT_SWEEP_INTERVAL_MS);
}, TIMEOUT_SWEEP_CRON_DELAY);

// ─────────────────────────────────────────────────────────────
// Anomaly Sweep Cron (audit FIX: no caller for SLA rules)
// Every 60 s, POST /api/anomalies/check with the shared cron secret
// so VENDOR_LATE / TASK_OVERDUE / VERIFICATION_MISSING rules fire on
// a quiet no-show instead of only on event-poke. The route is being
// hardened in parallel (dual ops-session OR x-cron-secret auth) —
// 401/404 are tolerated transiently (logged once per status change,
// never fatal).
// ─────────────────────────────────────────────────────────────

const ANOMALY_SWEEP_INTERVAL_MS = 60 * 1000; // 60 seconds
const ANOMALY_SWEEP_CRON_DELAY = 25 * 1000; // stagger vs timeout sweeper
let anomalySweepInFlight = false;

async function runAnomalySweep() {
  if (anomalySweepInFlight) return;
  anomalySweepInFlight = true;
  try {
    const res = await fetch("http://localhost:3000/api/anomalies/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      signal: AbortSignal.timeout(CRON_FETCH_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 404) {
      logCronOutcome("anomaly-sweep", `HTTP ${res.status}`);
      return;
    }
    logCronOutcome("anomaly-sweep", "ok");
    const data: any = await res.json().catch(() => null);
    if (res.ok && data && typeof data.created === "number" && data.created > 0) {
      console.log(`[cron] Anomaly sweep: ${data.created} new, ${data.skipped ?? 0} filtered`);
    }
  } catch (err) {
    // Non-critical — Next.js may not be up yet during startup
    console.warn("[cron] Anomaly sweep failed (non-critical):", err instanceof Error ? err.message : err);
  } finally {
    anomalySweepInFlight = false;
  }
}

setTimeout(() => {
  console.log(`[cron] Anomaly sweep active (every ${ANOMALY_SWEEP_INTERVAL_MS / 1000}s)`);
  runAnomalySweep();
  setInterval(runAnomalySweep, ANOMALY_SWEEP_INTERVAL_MS);
}, ANOMALY_SWEEP_CRON_DELAY);

// ─────────────────────────────────────────────────────────────
// Notification Dispatch Cron (audit FIX: PENDING-forever notifications)
// Every 60 s, POST /api/ops/notifications/dispatch with the shared
// cron secret. The route is created by a parallel agent (FIX-1d) —
// 404 is expected until it exists and is tolerated transiently.
// ─────────────────────────────────────────────────────────────

const NOTIFICATION_DISPATCH_INTERVAL_MS = 60 * 1000; // 60 seconds
const NOTIFICATION_DISPATCH_CRON_DELAY = 35 * 1000; // stagger vs the other ticks
let notificationDispatchInFlight = false;

async function runNotificationDispatch() {
  if (notificationDispatchInFlight) return;
  notificationDispatchInFlight = true;
  try {
    const res = await fetch("http://localhost:3000/api/ops/notifications/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      signal: AbortSignal.timeout(CRON_FETCH_TIMEOUT_MS),
    });
    if (res.status === 204) return; // nothing to send — normal case
    if (res.status === 401 || res.status === 404) {
      logCronOutcome("notification-dispatch", `HTTP ${res.status}`);
      return;
    }
    logCronOutcome("notification-dispatch", "ok");
    const data: any = await res.json().catch(() => null);
    if (res.ok && data && typeof data === "object") {
      const summary = Object.entries(data)
        .filter(([, v]) => typeof v === "number" && v > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (summary) {
        console.log(`[cron] Notification dispatch: ${summary}`);
      }
    }
  } catch (err) {
    // Non-critical — Next.js may not be up yet during startup
    console.warn("[cron] Notification dispatch failed (non-critical):", err instanceof Error ? err.message : err);
  } finally {
    notificationDispatchInFlight = false;
  }
}

setTimeout(() => {
  console.log(`[cron] Notification dispatcher active (every ${NOTIFICATION_DISPATCH_INTERVAL_MS / 1000}s)`);
  runNotificationDispatch();
  setInterval(runNotificationDispatch, NOTIFICATION_DISPATCH_INTERVAL_MS);
}, NOTIFICATION_DISPATCH_CRON_DELAY);

// ─────────────────────────────────────────────────────────────
// Phase 2 (§8): AI Case-Brief Coverage Sweep Cron
// Every 60 s, ask the Next.js app to run the AI dispute brief
// coverage pass: every qualifying dispute must hold an active
// brief (generate missing, retry failures, expire stale).
// Authenticated with the shared CRON_SECRET header — mirrors
// the issuance/expiry dispatchers above. This is the hard SLA
// backstop (≤60 s) behind the inline dispute-raised trigger.
// (Audit-AI-FIX8 port: hardened to this branch's cron
// conventions — in-flight guard + fetch timeout + outcome log.)
// ─────────────────────────────────────────────────────────────

const AI_BRIEF_SWEEP_INTERVAL_MS = 60 * 1000; // 60 seconds
const AI_BRIEF_SWEEP_CRON_DELAY = 50 * 1000; // stagger vs the other ticks
let aiBriefSweepInFlight = false;

async function runAiBriefSweep() {
  if (aiBriefSweepInFlight) return;
  aiBriefSweepInFlight = true;
  try {
    const res = await fetch("http://127.0.0.1:3000/api/ops/ai/cases/sweep", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      signal: AbortSignal.timeout(CRON_FETCH_TIMEOUT_MS),
    });
    if (res.status === 204) return; // nothing to do — normal case
    if (res.status === 401) {
      logCronOutcome("ai-brief-sweep", "HTTP 401 — cron secret rejected");
      return;
    }
    logCronOutcome("ai-brief-sweep", "ok");
    const data: any = await res.json().catch(() => null);
    if (res.ok && data && data.swept) {
      console.log(
        `[cron] AI brief sweep: qualifying=${data.qualifyingDisputes}, ensured=${data.ensured}, expired=${data.expired}, skipped=${data.skipped}`
      );
    }
  } catch (err) {
    // Non-critical — Next.js may not be up yet during startup
    console.warn("[cron] AI brief sweep failed (non-critical):", err instanceof Error ? err.message : err);
  } finally {
    aiBriefSweepInFlight = false;
  }
}

setTimeout(() => {
  console.log(`[cron] AI brief coverage sweep active (every ${AI_BRIEF_SWEEP_INTERVAL_MS / 1000}s)`);
  runAiBriefSweep();
  setInterval(runAiBriefSweep, AI_BRIEF_SWEEP_INTERVAL_MS);
}, AI_BRIEF_SWEEP_CRON_DELAY);

// ─────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[ops-events] Listening on ${PORT} (authenticated connections only)`);
});
