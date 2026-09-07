// ============================================================
// Anna.I — useHouseholdEvents React Hook
// Connects to the ops-events WebSocket service for real-time
// event streaming in the Household portal.
// Joins a room scoped to the selected household, so events
// are only delivered to the relevant household's browsers.
// ============================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { isAuthRejection, fetchEventToken } from "@/hooks/socket-auth";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface HouseholdEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface UseHouseholdEventsOptions {
  /** Called when any household event arrives */
  onEvent?: (event: HouseholdEvent) => void;
  /** Called for specific event types */
  handlers?: Record<string, (event: HouseholdEvent) => void>;
  /** Enable/disable connection (default: true) */
  enabled?: boolean;
}

interface UseHouseholdEventsReturn {
  /** Whether the socket is connected */
  isConnected: boolean;
  /** Recent events received since connection */
  recentEvents: HouseholdEvent[];
  /** Manually reconnect */
  reconnect: () => void;
}

// ─────────────────────────────────────────────────────────────
// Event type → display category mapping
// ─────────────────────────────────────────────────────────────

export type HouseholdEventCategory =
  | "escrow"
  | "dispute"
  | "task"
  | "booking"
  | "autonomy"
  | "photos"
  | "vendor"
  | "info";

export function getEventCategory(type: string): HouseholdEventCategory {
  if (type.startsWith("escrow")) return "escrow";
  if (type.startsWith("dispute")) return "dispute";
  if (type.startsWith("task") || type.startsWith("booking")) return "task";
  if (type.startsWith("work") || type.startsWith("photos")) return "vendor";
  if (type.startsWith("autonomy")) return "autonomy";
  return "info";
}

/** Map event types to human-readable action labels */
export function getEventLabel(type: string): string {
  const labels: Record<string, string> = {
    "escrow:state_changed": "Escrow Updated",
    "dispute:raised": "Dispute Raised",
    "dispute:resolved": "Dispute Resolved",
    "task:status_changed": "Task Updated",
    "booking:status_changed": "Booking Updated",
    "autonomy:promoted": "Autonomy Level Up",
    "work:completed": "Work Completed",
    "photos:uploaded": "New Photos Uploaded",
    "notification:created": "New Notification",
  };
  return labels[type] || "New Update";
}

/** Map event types to toast color theme */
export function getEventToastVariant(type: string): "success" | "warning" | "error" | "info" {
  const variants: Record<string, "success" | "warning" | "error" | "info"> = {
    "escrow:state_changed": "info",
    "dispute:raised": "error",
    "dispute:resolved": "success",
    "task:status_changed": "info",
    "booking:status_changed": "info",
    "autonomy:promoted": "success",
    "work:completed": "success",
    "photos:uploaded": "info",
    "notification:created": "info",
  };
  return variants[type] || "info";
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useHouseholdEvents(
  householdId: string | null | undefined,
  options: UseHouseholdEventsOptions = {}
): UseHouseholdEventsReturn {
  const { onEvent, handlers = {}, enabled = true } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [recentEvents, setRecentEvents] = useState<HouseholdEvent[]>([]);

  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const onEventRef = useRef(onEvent);
  const householdIdRef = useRef(householdId);
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
    householdIdRef.current = householdId;
  }, [householdId]);

  const connect = useCallback((eventToken?: string) => {
    if (socketRef.current?.connected) return;

    try {
      // NOTE: polling first is more reliable through the Caddy gateway (port 81).
      // Socket.IO will upgrade to websocket once the polling channel confirms
      // the connection works. This avoids "Connect error: timeout" when the
      // WS upgrade handshake is delayed or dropped by an intermediary.
      const socket = io("/?XTransformPort=3004", {
        transports: ["polling", "websocket"],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        timeout: 30000,
        auth: {
          type: "household",
          householdId: householdIdRef.current || undefined,
          // FIX-1b: the service verifies the household session cookie on the
          // handshake (same-origin, forwarded by the gateway). eventToken is
          // the short-lived fallback from /api/events/token, used only when
          // the cookie was unavailable.
          ...(eventToken ? { token: eventToken } : {}),
        },
      });
      console.log("[useHouseholdEvents] Socket created, connecting...");

      socket.on("connect", () => {
        console.log("[useHouseholdEvents] Connected!");
        setIsConnected(true);
        // Re-arm the one-shot auth fallback + log-once flags for the NEXT
        // connection lifecycle (e.g. a token expiring after 5 minutes).
        authFallbackArmedRef.current = true;
        connectErrorLoggedRef.current = false;

        // Join household room on connect
        if (householdIdRef.current) {
          socket.emit("join:household", { householdId: householdIdRef.current });
        }
      });

      socket.on("disconnect", () => {
        console.log("[useHouseholdEvents] Disconnected");
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
                "[useHouseholdEvents] Auth fallback failed — realtime updates disabled for this session"
              );
            }
          });
          return;
        }
        // Other errors (network, service down): socket.io retries with
        // backoff on its own — log once per lifecycle to avoid spam.
        if (!connectErrorLoggedRef.current) {
          connectErrorLoggedRef.current = true;
          console.warn("[useHouseholdEvents] Connect error:", err.message);
        }
      });

      // Confirm room join
      socket.on("household:joined", (data: { householdId: string }) => {
        console.log(`[useHouseholdEvents] Joined household room: ${data.householdId}`);
      });

      // ── Household-specific event channel ──
      socket.on("household:event", (event: HouseholdEvent) => {
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

      // ── Type-specific household event handlers ──
      const registeredTypes = Object.keys(handlersRef.current);
      for (const type of registeredTypes) {
        socket.on(`household:event:${type}`, (event: HouseholdEvent) => {
          const currentHandlers = handlersRef.current;
          const typedHandler = currentHandlers[type];
          if (typedHandler) {
            typedHandler(event);
          }
        });
      }

      socketRef.current = socket;
    } catch (err) {
      console.error("[useHouseholdEvents] Failed to create socket:", err);
    }
  }, [householdIdRef]);

  // Keep the latest connect callback reachable from the fallback path
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // ── Handle household ID changes (join/leave rooms) ──
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    if (householdId) {
      socket.emit("join:household", { householdId });
    } else {
      socket.emit("leave:household");
    }
  }, [householdId]);

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
