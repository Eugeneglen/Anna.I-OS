// ============================================================
// Anna.I — useVendorEvents React Hook
// Connects to the ops-events WebSocket service for real-time
// event streaming in the Vendor portal.
// Joins a room scoped to the vendor, so events are only
// delivered to the relevant vendor's browser sessions.
// Mirrors the useHouseholdEvents pattern.
// ============================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { isAuthRejection, fetchEventToken } from "@/hooks/socket-auth";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface VendorEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface UseVendorEventsOptions {
  /** Called when any vendor event arrives */
  onEvent?: (event: VendorEvent) => void;
  /** Called for specific event types */
  handlers?: Record<string, (event: VendorEvent) => void>;
  /** Enable/disable connection (default: true) */
  enabled?: boolean;
}

interface UseVendorEventsReturn {
  /** Whether the socket is connected */
  isConnected: boolean;
  /** Recent events received since connection */
  recentEvents: VendorEvent[];
  /** Manually reconnect */
  reconnect: () => void;
}

// ─────────────────────────────────────────────────────────────
// Event type → display category mapping
// ─────────────────────────────────────────────────────────────

export type VendorEventCategory =
  | "booking"
  | "task"
  | "escrow"
  | "dispute"
  | "verification"
  | "info";

export function getVendorEventCategory(type: string): VendorEventCategory {
  if (type.startsWith("booking")) return "booking";
  if (type.startsWith("task")) return "task";
  if (type.startsWith("escrow")) return "escrow";
  if (type.startsWith("dispute")) return "dispute";
  if (type.startsWith("verification") || type.startsWith("photos")) return "verification";
  return "info";
}

/** Map event types to human-readable action labels (for toasts) */
export function getVendorEventLabel(type: string): string {
  const labels: Record<string, string> = {
    "vendor:notification": "New Notification",
    "booking:status_changed": "Booking Updated",
    "task:status_changed": "Task Updated",
    "task:dispatched": "New Booking Request",
    "escrow:state_changed": "Payment Updated",
    "dispute:raised": "Dispute Raised",
    "dispute:resolved": "Dispute Resolved",
    "verification:approved": "Photos Approved",
    "verification:rejected": "Photos Rejected",
    "work:completed": "Work Completed",
  };
  return labels[type] || "New Update";
}

/** Map event types to toast color theme */
export function getVendorEventToastVariant(
  type: string
): "success" | "warning" | "error" | "info" {
  const variants: Record<string, "success" | "warning" | "error" | "info"> = {
    "vendor:notification": "info",
    "booking:status_changed": "info",
    "task:status_changed": "info",
    "task:dispatched": "info",
    "escrow:state_changed": "success",
    "dispute:raised": "error",
    "dispute:resolved": "warning",
    "verification:approved": "success",
    "verification:rejected": "error",
    "work:completed": "success",
  };
  return variants[type] || "info";
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useVendorEvents(
  vendorId: string | null | undefined,
  options: UseVendorEventsOptions = {}
): UseVendorEventsReturn {
  const { onEvent, handlers = {}, enabled = true } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [recentEvents, setRecentEvents] = useState<VendorEvent[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const onEventRef = useRef(onEvent);
  const vendorIdRef = useRef(vendorId);
  // FIX-1b: auth fallback / log-once state (see socket-auth.ts)
  const authFallbackArmedRef = useRef(true);
  const connectErrorLoggedRef = useRef(false);
  const fallbackLoggedRef = useRef(false);
  // Latest connect callback, so the auth-fallback path can re-enter connect
  // without a self-referencing closure.
  const connectRef = useRef<((eventToken?: string) => void) | null>(null);

  // Keep refs up to date without triggering reconnects
  useEffect(() => {
    handlersRef.current = handlers;
    onEventRef.current = onEvent;
  }, [handlers, onEvent]);

  useEffect(() => {
    vendorIdRef.current = vendorId;
  }, [vendorId]);

  const connect = useCallback((eventToken?: string) => {
    if (socketRef.current?.connected) return;

    try {
      const socket = io("/?XTransformPort=3004", {
        transports: ["websocket", "polling"],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        timeout: 30000,
        auth: {
          type: "vendor",
          vendorId: vendorIdRef.current || undefined,
          // FIX-1b: the service verifies the vendor session cookie on the
          // handshake (same-origin, forwarded by the gateway). eventToken is
          // the short-lived fallback from /api/events/token, used only when
          // the cookie was unavailable.
          ...(eventToken ? { token: eventToken } : {}),
        },
      });
      console.log("[useVendorEvents] Socket created, connecting...");

      socket.on("connect", () => {
        console.log("[useVendorEvents] Connected!");
        setIsConnected(true);
        // Re-arm the one-shot auth fallback + log-once flags for the NEXT
        // connection lifecycle (e.g. a token expiring after 5 minutes).
        authFallbackArmedRef.current = true;
        connectErrorLoggedRef.current = false;

        // Join vendor room on connect
        if (vendorIdRef.current) {
          socket.emit("join:vendor", { vendorId: vendorIdRef.current });
        }
      });

      socket.on("disconnect", () => {
        console.log("[useVendorEvents] Disconnected");
        setIsConnected(false);
      });

      socket.on("connect_error", (err) => {
        // FIX-1b: the service rejects unauthenticated handshakes with an
        // "unauthorized..." error. Socket.io does NOT auto-reconnect after
        // a middleware rejection, so there is no reconnect spam — we get
        // exactly one shot at a token fallback per connection lifecycle.
        if (authFallbackArmedRef.current && isAuthRejection(err)) {
          authFallbackArmedRef.current = false;
          socket.disconnect();
          if (socketRef.current === socket) {
            socketRef.current = null;
          }
          fetchEventToken().then((token) => {
            if (token) {
              connectRef.current?.(token);
            } else if (!fallbackLoggedRef.current) {
              fallbackLoggedRef.current = true;
              console.warn(
                "[useVendorEvents] Auth fallback failed — realtime updates disabled for this session"
              );
            }
          });
          return;
        }
        // Other errors (network, service down): socket.io retries with
        // backoff on its own — log once per lifecycle to avoid spam.
        if (!connectErrorLoggedRef.current) {
          connectErrorLoggedRef.current = true;
          console.warn("[useVendorEvents] Connect error:", err.message);
        }
      });

      // Confirm room join
      socket.on("vendor:joined", (data: { vendorId: string }) => {
        console.log(`[useVendorEvents] Joined vendor room: ${data.vendorId}`);
      });

      // ── Vendor-specific event channel ──
      socket.on("vendor:event", (event: VendorEvent) => {
        setRecentEvents((prev) => [...prev, event].slice(-50));

        // Call generic handler via ref
        if (onEventRef.current) {
          onEventRef.current(event);
        }

        // Call type-specific handler via ref
        const currentHandlers = handlersRef.current;
        const typedHandler = currentHandlers[event.type];
        if (typedHandler) {
          typedHandler(event);
        }
      });

      // ── Type-specific vendor event handlers ──
      const registeredTypes = Object.keys(handlersRef.current);
      for (const type of registeredTypes) {
        socket.on(`vendor:event:${type}`, (event: VendorEvent) => {
          const currentHandlers = handlersRef.current;
          const typedHandler = currentHandlers[type];
          if (typedHandler) {
            typedHandler(event);
          }
        });
      }

      socketRef.current = socket;
    } catch (err) {
      console.error("[useVendorEvents] Failed to create socket:", err);
    }
  }, [vendorIdRef]);

  // Keep the latest connect callback reachable from the fallback path
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // ── Handle vendor ID changes (join/leave rooms) ──
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (vendorId) {
      socket.emit("join:vendor", { vendorId });
    } else {
      socket.emit("leave:vendor");
    }
  }, [vendorId]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setRecentEvents([]);
    }
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(() => connect(), 500);
  }, [connect, disconnect]);

  // Connect on mount if enabled
  useEffect(() => {
    if (enabled) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    isConnected,
    recentEvents,
    reconnect,
  };
}
